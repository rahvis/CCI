#!/usr/bin/env bash
# Bootstraps the Azure Confidential VM: vLLM + Gemma-1B + chat UI + attestation proof.
set -euxo pipefail
exec > >(tee -a /var/log/cci-bootstrap.log) 2>&1

export DEBIAN_FRONTEND=noninteractive
MODEL_ID="unsloth/gemma-3-1b-it"   # ungated public mirror of Gemma 3 1B instruct
APP_DIR="/opt/cci"
VENV_DIR="${APP_DIR}/venv"

mkdir -p "${APP_DIR}"

apt-get update -y
apt-get install -y --no-install-recommends \
  python3.11 python3.11-venv python3.11-dev python3-pip git build-essential cmake gcc-12 g++-12 \
  libnuma-dev numactl curl jq ca-certificates gnupg lsb-release \
  libcurl4-openssl-dev libjsoncpp-dev libboost-all-dev nlohmann-json3-dev

# ---- Python env + vLLM (CPU backend) ----
rm -rf "${VENV_DIR}" /opt/vllm-src
python3.11 -m venv "${VENV_DIR}"
source "${VENV_DIR}/bin/activate"
pip install --upgrade pip
pip install cmake ninja packaging jinja2 wheel \
  "setuptools>=77.0.3,<81.0.0" "setuptools-scm>=8.0" "setuptools-rust>=1.9.0"

if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  source "$HOME/.cargo/env"
fi
export PATH="$HOME/.cargo/bin:${PATH}"

git clone --depth 1 https://github.com/vllm-project/vllm.git /opt/vllm-src
cd /opt/vllm-src
pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements/cpu.txt

# gcc-12 doesn't recognize the "avx10.2" feature string for __builtin_cpu_supports
# (added to GCC only in later versions); stub it out - it only gates an FP8 GEMM
# kernel path we don't use, and this Milan CPU has no AVX10 hardware anyway.
sed -i \
  's/static const bool available = __builtin_cpu_supports("avx10.2");/static const bool available = false; \/\/ gcc-12 does not recognize avx10.2; unused on AMD Milan anyway/' \
  csrc/cpu/sgl-kernels/common.h

export CC=/usr/bin/gcc-12
export CXX=/usr/bin/g++-12
MAX_JOBS=4 VLLM_TARGET_DEVICE=cpu pip install --extra-index-url https://download.pytorch.org/whl/cpu -e . --no-build-isolation

pip install huggingface_hub fastapi uvicorn jinja2 httpx

# Ubuntu 22.04 ships python3.11 as 3.11.0~rc1, which predates sys.get_int_max_str_digits
# (added in 3.11.0 final). Torch gates that polyfill on a version check the RC satisfies,
# so make the guard feature-based - matching how torch behaves on 3.10.
sed -i 's/^if sys.version_info >= (3, 11):$/if sys.version_info >= (3, 11) and hasattr(sys, "get_int_max_str_digits"):/' \
  "${VENV_DIR}/lib/python3.11/site-packages/torch/_dynamo/polyfills/sys.py"

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
# app.py is scp'd to ${APP_DIR}/webapp/app.py before this script runs.
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

# ---- Guest attestation client (proves SEV-SNP confidential VM to Microsoft Azure Attestation) ----
# azguestattestation1 is NOT in any apt index (only raw .deb files under this pool/ dir) -
# must dpkg -i it directly rather than apt-get install.
curl -sSL -o /tmp/azguestattestation1.deb \
  https://packages.microsoft.com/repos/azurecore/pool/main/a/azguestattestation1/azguestattestation1_1.1.2_amd64.deb
dpkg -i /tmp/azguestattestation1.deb

git clone --depth 1 https://github.com/Azure/confidential-computing-cvm-guest-attestation.git /opt/cvm-guest-attestation
cd /opt/cvm-guest-attestation/cvm-attestation-sample-app
cmake .
make
install -m 0755 ./AttestationClient /usr/local/bin/AttestationClient

systemctl daemon-reload
systemctl enable --now vllm.service
systemctl enable --now cci-webapp.service

echo "BOOTSTRAP_COMPLETE" > /opt/cci/bootstrap.done
