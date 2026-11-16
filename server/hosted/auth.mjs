import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { AppError } from '../errors.mjs';

export function hostedAuth(req, res, { supabaseUrl, publishableKey, appUrl }) {
  const secure = new URL(appUrl).protocol === 'https:';
  const client = createServerClient(supabaseUrl, publishableKey, {
    cookieOptions: { name: 'nextstep-auth', httpOnly: true, secure, sameSite: 'lax', path: '/' },
    cookies: {
      getAll: () => parseCookieHeader(req.headers.cookie || ''),
      setAll: (cookies, headers) => {
        for (const [name,value] of Object.entries(headers || {})) res.setHeader(name,value);
        const existing = res.getHeader('Set-Cookie') || [];
        res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), ...cookies.map(({ name, value, options }) => serializeCookieHeader(name, value, { ...options, httpOnly: true, secure, sameSite: 'lax', path: '/' }))]);
      },
    },
  });
  return {
    async login() {
      const { data, error } = await client.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: `${appUrl}/api/auth/callback` } });
      if (error || !data.url) throw new AppError('Apple sign-in is unavailable. Please try again.', 503);
      return data.url;
    },
    async exchange(code) {
      if (!code || code.length > 4096) throw new AppError('This sign-in link is invalid or expired.', 400);
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw new AppError('This sign-in link is invalid or expired. Please sign in again.', 401);
    },
    async user() {
      const { data: { user }, error } = await client.auth.getUser();
      if (error || !user) return null;
      if (user.is_anonymous || !user.identities?.some((identity) => identity.provider === 'apple') || !user.email_confirmed_at)
        throw new AppError('Use your invited Apple account to sign in.', 403);
      return { id: user.id, email: user.email?.toLowerCase() || '', kind: 'person' };
    },
    async logout() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw new AppError('Could not sign out. Please try again.', 503);
    },
  };
}
