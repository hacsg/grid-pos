import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete, LockKeyhole } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { login } from '@/api/client';

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'backspace'];

export default function Login() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('auth_token')) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  function pressPinKey(key: string) {
    if (key === 'clear') {
      setPin('');
      return;
    }
    if (key === 'backspace') {
      setPin((current) => current.slice(0, -1));
      return;
    }
    setPin((current) => (current.length >= 4 ? current : `${current}${key}`));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim()) {
      toast.error('Enter your name');
      return;
    }
    if (pin.length !== 4) {
      toast.error('Enter a 4-digit PIN');
      return;
    }

    try {
      setLoading(true);
      const response = await login({
        name: name.trim(),
        pin,
        // no outlet_id for admin login
      });
      localStorage.setItem('auth_token', response.access_token);
      navigate('/', { replace: true });
    } catch {
      setPin('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-white">
            G
          </div>
          <h1 className="text-2xl font-bold text-text">Grid POS Admin</h1>
          <p className="mt-1 text-sm text-text-muted">Sign in to manage your outlets</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="card space-y-5 p-6 sm:p-8"
        >
          <Input
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            autoComplete="name"
            disabled={loading}
          />

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-text">
              <LockKeyhole className="h-4 w-4 text-text-muted" />
              PIN
            </div>

            <div
              className="flex justify-center gap-3"
              aria-label="PIN entry"
            >
              {Array.from({ length: 4 }).map((_, index) => (
                <span
                  key={index}
                  className={`h-3 w-3 rounded-full border-2 transition-colors ${
                    pin[index]
                      ? 'border-primary bg-primary'
                      : 'border-gray-300 bg-white'
                  }`}
                />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {PIN_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={loading}
                  onClick={() => pressPinKey(key)}
                  aria-label={
                    key === 'backspace' ? 'Backspace' : key === 'clear' ? 'Clear' : key
                  }
                  className="flex h-12 items-center justify-center rounded-lg border border-gray-200 bg-white text-lg font-medium text-text transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
                >
                  {key === 'backspace' ? (
                    <Delete className="h-5 w-5" />
                  ) : key === 'clear' ? (
                    'Clear'
                  ) : (
                    key
                  )}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            loading={loading}
            disabled={!name.trim() || pin.length !== 4}
            className="w-full"
          >
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}