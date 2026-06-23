package kpay

const ( CodeSuccess = 10000; CodeKeyExpired = 40004 )

type Response[T any] struct{ Code int `json:"code"`; Data T `json:"data"`; Message string `json:"message"` }
type Error struct{ Code int; Message string }
func (e *Error) Error() string { if e.Message != "" { return e.Message }; return "kpay error" }

type SignRequest struct{ AppID string `json:"appId"`; AppSecret string `json:"appSecret"` }
type SignData struct{ PlatformPublicKey string `json:"platformPublicKey"`; AppPrivateKey string `json:"appPrivateKey"` }
type SaleRequest struct{ OutTradeNo string `json:"outTradeNo"`; PayAmount string `json:"payAmount"`; PayCurrency string `json:"payCurrency"`; PaymentType int `json:"paymentType"`; CallbackURL string `json:"callbackUrl,omitempty"`; MemberCode string `json:"memberCode,omitempty"`; IncludeReceipt *bool `json:"includeReceipt,omitempty"` }
type QueryData struct{ OutTradeNO string `json:"outTradeNO"`; TransactionNo string `json:"transactionNo"`; RefNo string `json:"refNo,omitempty"`; PayAmount string `json:"payAmount"`; PayCurrency string `json:"payCurrency"`; PayMethod int `json:"payMethod"`; TransactionType int `json:"transactionType"`; PayResult int `json:"payResult"` }
type CancelRequest struct{ OutTradeNo string `json:"outTradeNo"`; OriginOutTradeNo string `json:"originOutTradeNo"`; ManagerPassword string `json:"managerPassword"`; CallbackURL string `json:"callbackUrl,omitempty"` }
type RefundRequest struct{ OutTradeNo string `json:"outTradeNo"`; RefundType int `json:"refundType"`; RefNo string `json:"refNo,omitempty"`; TransactionNo string `json:"transactionNo,omitempty"`; CommitTime int64 `json:"commitTime,omitempty"`; RefundAmount string `json:"refundAmount"`; ManagerPassword string `json:"managerPassword"`; CallbackURL string `json:"callbackUrl,omitempty"` }
