#!/usr/bin/env bash
# Resumes bootstrap after the avx10.2 builtin compile failure, reusing the
# existing CMake build cache instead of restarting the whole build.
set -euxo pipefail
exec > >(tee -a /var/log/cci-bootstrap.log) 2>&1

MODEL_ID="unsloth/gemma-3-1b-it"
APP_DIR="/opt/cci"
VENV_DIR="${APP_DIR}/venv"

# ---- Patch the gcc-12-incompatible AVX10.2 builtin (unused on this Milan CPU anyway) ----
sed -i \
  's/static const bool available = __builtin_cpu_supports("avx10.2");/static const bool available = false; \/\/ gcc-12 does not recognize avx10.2; unused on AMD Milan anyway/' \
  /opt/vllm-src/csrc/cpu/sgl-kernels/common.h
grep -n "avx10_2_available" -A2 /opt/vllm-src/csrc/cpu/sgl-kernels/common.h

source "${VENV_DIR}/bin/activate"
cd /opt/vllm-src
export CC=/usr/bin/gcc-12
export CXX=/usr/bin/g++-12
MAX_JOBS=4 VLLM_TARGET_DEVICE=cpu pip install --extra-index-url https://download.pytorch.org/whl/cpu -e . --no-build-isolation

pip install huggingface_hub fastapi uvicorn jinja2 httpx

# ---- Pre-download the model so the systemd unit starts fast ----
python3.11 - <<PYEOF
from huggingface_hub import snapshot_download
snapshot_download(repo_id="${MODEL_ID}", local_dir="/opt/cci/model", local_dir_use_symlinks=False)
PYEOF

# ---- systemd unit: vLLM OpenAI-compatible server ----
cat > /etc/systemd/system/vllm.service <<UNIT
[Unit]
Description=vLLM OpenAI-compatible inference server (Gemma-1B)
After=network-online.target

[Service]
Type=simple
Environment=VLLM_CPU_KVCACHE_SPACE=4
Environment=VLLM_CPU_OMP_THREADS_BIND=nobind
Environment=OMP_NUM_THREADS=3
Environment=VLLM_CPU_NUM_OF_RESERVED_CPU=1
Environment=VLLM_CPU_DISABLE_AVX512=true
ExecStart=${VENV_DIR}/bin/vllm serve /opt/cci/model \
  --served-model-name gemma-1b \
  --host 127.0.0.1 --port 8000 \
  --dtype float32 --max-model-len 4096 \
  --block-size 32 --enforce-eager
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
UNIT

# ---- Chat UI + attestation proxy (FastAPI) ----
mkdir -p "${APP_DIR}/webapp"

cat > /etc/systemd/system/cci-webapp.service <<UNIT
[Unit]
Description=CCI chat UI + attestation proxy
After=network-online.target vllm.service

[Service]
Type=simple
WorkingDirectory=${APP_DIR}/webapp
ExecStart=${VENV_DIR}/bin/uvicorn app:app --host 0.0.0.0 --port 80
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
UNIT

# ---- Guest attestation client ----
# azguestattestation1 is NOT in any apt index (raw .deb files only) - dpkg -i directly.
curl -sSL -o /tmp/azguestattestation1.deb \
  https://packages.microsoft.com/repos/azurecore/pool/main/a/azguestattestation1/azguestattestation1_1.1.2_amd64.deb
dpkg -i /tmp/azguestattestation1.deb

rm -rf /opt/cvm-guest-attestation
git clone --depth 1 https://github.com/Azure/confidential-computing-cvm-guest-attestation.git /opt/cvm-guest-attestation
cd /opt/cvm-guest-attestation/cvm-attestation-sample-app
cmake .
make
install -m 0755 ./AttestationClient /usr/local/bin/AttestationClient

systemctl daemon-reload
systemctl enable --now vllm.service
systemctl enable --now cci-webapp.service

echo "BOOTSTRAP_COMPLETE" > /opt/cci/bootstrap.done
