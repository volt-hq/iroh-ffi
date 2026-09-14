#!/usr/bin/env python3
"""Generate public, deliberately non-secret TLS fixtures. NEVER use in a server deployment."""
import pathlib
import subprocess
import tempfile

output = pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "tls"
output.mkdir(parents=True, exist_ok=True)


def openssl(*args):
    subprocess.run(["openssl", *args], check=True, stdout=subprocess.DEVNULL,
                   stderr=subprocess.PIPE)


with tempfile.TemporaryDirectory(prefix="iroh-tls-fixtures-") as directory:
    work = pathlib.Path(directory)
    for name in ("root", "other-root"):
        openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "36500",
                "-subj", f"/CN=IROH TEST ONLY {name}", "-keyout", str(work / f"{name}.key"),
                "-out", str(work / f"{name}.pem"))
        openssl("x509", "-in", str(work / f"{name}.pem"), "-outform", "DER",
                "-out", str(output / f"{name}.der"))
    (work / "index").touch()
    (work / "serial").write_text("01\n")
    config = work / "ca.cnf"
    config.write_text(f"""[ca]
default_ca=authority
[authority]
database={work}/index
new_certs_dir={work}
serial={work}/serial
certificate={work}/root.pem
private_key={work}/root.key
default_md=sha256
policy=policy
unique_subject=no
[policy]
commonName=supplied
[server]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
""")
    openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost",
            "-keyout", str(output / "server-key.pem"), "-out", str(work / "server.csr"))
    for name, expiry in (("server", "20990101000000Z"), ("expired", "20200102000000Z")):
        openssl("ca", "-batch", "-notext", "-config", str(config), "-extensions", "server",
                "-in", str(work / "server.csr"), "-out", str(output / f"{name}.pem"),
                "-startdate", "20200101000000Z", "-enddate", expiry)
        openssl("x509", "-in", str(output / f"{name}.pem"), "-outform", "DER",
                "-out", str(output / f"{name}.der"))
    openssl("pkcs8", "-topk8", "-nocrypt", "-in", str(output / "server-key.pem"),
            "-outform", "DER", "-out", str(output / "server-key.der"))
print(output)
