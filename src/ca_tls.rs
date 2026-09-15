//! Shared validation for the UniFFI and napi custom-CA surfaces.
//!
//! These roots affect HTTPS services, not Iroh's peer-identity authentication.
use iroh::tls::CaTlsConfig;
use rustls::{RootCertStore, pki_types::CertificateDer};

pub(crate) fn custom_ca_tls_config(roots: Vec<Vec<u8>>) -> anyhow::Result<CaTlsConfig> {
    anyhow::ensure!(
        !roots.is_empty() && roots.len() <= 8,
        "ca_roots must contain between 1 and 8 DER certificates"
    );
    let mut store = RootCertStore::empty();
    let mut certificates = Vec::with_capacity(roots.len());
    for root in roots {
        anyhow::ensure!(
            !root.is_empty() && root.len() <= 16 * 1024,
            "each ca_roots certificate must contain between 1 and 16384 bytes"
        );
        let certificate = CertificateDer::from(root);
        // Validate every input rather than silently dropping malformed roots.
        store
            .add(certificate.clone())
            .map_err(|_| anyhow::anyhow!("ca_roots contains an invalid DER certificate"))?;
        certificates.push(certificate);
    }
    // Replace public roots, do not append to them. A private rig should trust
    // only its own authority. Rustls still checks names, dates and signatures.
    Ok(CaTlsConfig::custom_roots(certificates))
}
