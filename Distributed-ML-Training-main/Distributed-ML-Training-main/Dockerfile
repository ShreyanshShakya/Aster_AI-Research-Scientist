FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app

COPY requirements.txt ./
# Install CPU PyTorch explicitly so the local Compose demo does not require an NVIDIA runtime.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple torch==2.3.1 torchvision==0.18.1 \
    && pip install --no-cache-dir 'psutil>=5.9.0' 'tensorboard>=2.13.0' 'PyYAML>=6.0' 'numpy>=1.24.0' 'grpcio>=1.60.0' 'grpcio-tools>=1.60.0' 'protobuf>=4.25.0' rich

COPY . .
EXPOSE 50051 8002
