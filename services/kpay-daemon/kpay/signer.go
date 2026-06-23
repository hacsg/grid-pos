package kpay

import (
	"crypto"; "crypto/rand"; "crypto/rsa"; "crypto/sha256"; "encoding/base64"; "encoding/hex"; "fmt"; "time"
)

func Nonce() (string, error) { b := make([]byte, 16); _, err := rand.Read(b); return hex.EncodeToString(b), err }
func TimestampMS() string { return fmt.Sprintf("%d", time.Now().UTC().UnixMilli()) }
func Sign(priv *rsa.PrivateKey, method, path, ts, nonce string, body []byte) (string, error) {
	msg := method + "\n" + path + "\n" + ts + "\n" + nonce + "\n"; if method != "GET" { msg += string(body) + "\n" }
	sum := sha256.Sum256([]byte(msg)); sig, err := rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, sum[:]); if err != nil { return "", err }
	return base64.StdEncoding.EncodeToString(sig), nil
}
