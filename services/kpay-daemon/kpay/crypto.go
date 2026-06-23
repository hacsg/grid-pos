package kpay

import (
	"crypto/rand"; "crypto/rsa"; "crypto/x509"; "encoding/base64"; "encoding/pem"; "fmt"; "strings"
)

func ParsePrivateKey(s string) (*rsa.PrivateKey, error) {
	der, err := keyDER(s); if err != nil { return nil, err }
	key, err := x509.ParsePKCS8PrivateKey(der); if err != nil { return nil, err }
	rk, ok := key.(*rsa.PrivateKey); if !ok { return nil, fmt.Errorf("appPrivateKey is not RSA") }; return rk, nil
}
func ParsePublicKey(s string) (*rsa.PublicKey, error) {
	der, err := keyDER(s); if err != nil { return nil, err }
	key, err := x509.ParsePKIXPublicKey(der); if err != nil { return nil, err }
	rk, ok := key.(*rsa.PublicKey); if !ok { return nil, fmt.Errorf("platformPublicKey is not RSA") }; return rk, nil
}
func EncryptManagerPassword(password string, pub *rsa.PublicKey) (string, error) {
	enc, err := rsa.EncryptPKCS1v15(rand.Reader, pub, []byte(password)); if err != nil { return "", err }
	return base64.StdEncoding.EncodeToString(enc), nil
}
func keyDER(s string) ([]byte, error) {
	s = strings.ReplaceAll(strings.ReplaceAll(s, `\u003d`, "="), "\u003d", "=")
	if block, _ := pem.Decode([]byte(s)); block != nil { return block.Bytes, nil }
	for _, m := range []string{"-----BEGIN PRIVATE KEY-----", "-----END PRIVATE KEY-----", "-----BEGIN PUBLIC KEY-----", "-----END PUBLIC KEY-----"} { s = strings.ReplaceAll(s, m, "") }
	return base64.StdEncoding.DecodeString(strings.Join(strings.Fields(s), ""))
}
