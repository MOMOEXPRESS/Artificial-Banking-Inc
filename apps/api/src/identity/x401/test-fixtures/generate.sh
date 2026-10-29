#!/usr/bin/env bash
# TEST-ONLY x401 fixtures. These keys and certificates are throwaway and are
# trusted by nothing except the x401 unit tests. Never configure them in
# X401_TRUSTED_ISSUERS for a real deployment.
# Regenerate: bash generate.sh   (needs OpenSSL >= 3.4 for -not_before/-not_after)
set -euo pipefail
cd "$(dirname "$0")"
ec() { openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$1"; }
ca() { # name subject
  ec "$1.key.pem"
  openssl req -x509 -new -key "$1.key.pem" -subj "$2" -days 3650 -sha256 \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "$1.cert.pem"
}
leaf() { # name subject ca [not_before not_after]
  ec "$1.key.pem"
  openssl req -new -key "$1.key.pem" -subj "$2" -out "$1.csr"
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n' > "$1.ext"
  if [ $# -ge 5 ]; then
    openssl x509 -req -in "$1.csr" -CA "$3.cert.pem" -CAkey "$3.key.pem" -sha256 \
      -not_before "$4" -not_after "$5" -extfile "$1.ext" -out "$1.cert.pem"
  else
    openssl x509 -req -in "$1.csr" -CA "$3.cert.pem" -CAkey "$3.key.pem" -sha256 \
      -days 3650 -extfile "$1.ext" -out "$1.cert.pem"
  fi
  rm -f "$1.csr" "$1.ext"
}
ca test-root "/O=ABI TEST ONLY/CN=ABI x401 Test Root CA"
leaf test-issuer "/O=ABI TEST ONLY/CN=ABI x401 Test Issuer" test-root
leaf expired-issuer "/O=ABI TEST ONLY/CN=ABI x401 Expired Issuer" test-root 20200101000000Z 20210101000000Z
ca other-root "/O=ABI TEST ONLY/CN=Untrusted x401 Test Root CA"
leaf other-issuer "/O=ABI TEST ONLY/CN=Untrusted x401 Test Issuer" other-root
rm -f test-root.key.pem other-root.key.pem ./*.srl
