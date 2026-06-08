import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Delete, LockKeyhole } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import api, { login } from '@/api/client';
import type { Outlet } from '@/types';

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'backspace'];

async function fetchOutlets(): Promise<Outlet[]> {
  const { data } = await api.get('/outlets');
  return Array.isArray(data) ? data : (data.data ?? []);
}

export default function Login() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [outletId, setOutletId] = useState('');
  const [loading, setLoading] = useState(false);

  const outletsQuery = useQuery({
    queryKey: ['outlets', 'login'],
    queryFn: fetchOutlets,
  });

  const outlets = outletsQuery.data ?? [];

  useEffect(() => {
    if (localStorage.getItem('auth_token')) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (!outletId && outlets.length > 0) {
      setOutletId(outlets[0].id);
    }
  }, [outlets, outletId]);

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
    if (!outletId) {
      toast.error('Select an outlet');
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
        outlet_id: outletId,
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

          <div className="flex flex-col gap-1.5">
            <label htmlFor="outlet" className="text-sm font-medium text-text">
              Outlet
            </label>
            <select
              id="outlet"
              value={outletId}
              onChange={(event) => setOutletId(event.target.value)}
              disabled={outletsQuery.isLoading || loading || outlets.length === 0}
              className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </select>
          </div>

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
            disabled={!name.trim() || !outletId || pin.length !== 4}
            className="w-full"
          >
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}