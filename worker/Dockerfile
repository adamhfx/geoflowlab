FROM python:3.12-slim-bookworm

# The candidate workbook uses functions that are not available in Debian's
# LibreOffice 7.4 package. Pin the official TDF 26.8.0 x86-64 deb archive and
# verify it before unpacking; do not silently substitute a distro build.
ARG LO_URL=https://download.documentfoundation.org/libreoffice/stable/26.8.0/deb/x86_64/LibreOffice_26.8.0_Linux_x86-64_deb.tar.gz
ARG LO_SHA256=d0a6031a3837e48f9854e6d2da6489b9fadbd814afa4741fa32a197741663a22
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl fonts-liberation tar libcairo2 libxinerama1 libxrender1 libsm6 libdbus-1-3 libnss3 libxslt1.1 libx11-6 libxext6 libglu1-mesa \
 && curl --fail --silent --show-error --location "$LO_URL" --output /tmp/libreoffice.tar.gz \
 && echo "$LO_SHA256  /tmp/libreoffice.tar.gz" | sha256sum --check --status \
 && mkdir -p /tmp/libreoffice \
 && tar -xzf /tmp/libreoffice.tar.gz --strip-components=1 -C /tmp/libreoffice \
 && (dpkg -i /tmp/libreoffice/DEBS/*.deb || true) \
 && apt-get install -y --no-install-recommends -f \
 && /opt/libreoffice26.8/program/soffice --headless --version \
 && rm -rf /tmp/libreoffice /tmp/libreoffice.tar.gz /var/lib/apt/lists/*
WORKDIR /app
COPY worker/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY worker /app/worker
RUN useradd --create-home runner && chown -R runner:runner /app
USER runner
ENV PYTHONUNBUFFERED=1 SOFFICE_BIN=/opt/libreoffice26.8/program/soffice
CMD ["python", "-m", "worker.jobs"]
