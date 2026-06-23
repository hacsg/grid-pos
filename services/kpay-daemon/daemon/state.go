package daemon

import ( "context"; "crypto/rsa"; "sync"; "time" )

type State struct{ mu sync.Mutex; priv *rsa.PrivateKey; pub *rsa.PublicKey; lastReq time.Time }
func NewState() *State { return &State{} }
func (s *State) Keys() (*rsa.PrivateKey, *rsa.PublicKey, bool) {
	s.mu.Lock(); defer s.mu.Unlock(); return s.priv, s.pub, s.priv != nil && s.pub != nil
}
func (s *State) SetKeys(priv *rsa.PrivateKey, pub *rsa.PublicKey) {
	s.mu.Lock(); defer s.mu.Unlock(); s.priv, s.pub = priv, pub
}
func (s *State) ClearKeys() { s.mu.Lock(); defer s.mu.Unlock(); s.priv, s.pub = nil, nil }
func (s *State) Wait(ctx context.Context) error {
	for {
		s.mu.Lock(); wait := time.Until(s.lastReq.Add(800*time.Millisecond))
		if wait <= 0 { s.lastReq = time.Now(); s.mu.Unlock(); return nil }
		s.mu.Unlock(); t := time.NewTimer(wait)
		select { case <-ctx.Done(): t.Stop(); return ctx.Err(); case <-t.C: }
	}
}
