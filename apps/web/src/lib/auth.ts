import { supabase } from './supabase';

export interface SessionInfo {
  email: string;
  /** true when the session still needs a second factor */
  needsMfa: boolean;
}

export interface TotpEnrollment {
  factorId: string;
  qrSvg: string;
  secret: string;
}

export interface AuthApi {
  session(): Promise<SessionInfo | null>;
  onChange(cb: (event: string) => void): () => void;
  signIn(email: string, password: string): Promise<SessionInfo>;
  verifyMfa(code: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  factors(): Promise<{ id: string; status: string; friendly_name?: string }[]>;
  enrollTotp(): Promise<TotpEnrollment>;
  confirmTotp(factorId: string, code: string): Promise<void>;
  unenroll(factorId: string): Promise<void>;
}

const GENERIC_LOGIN_ERROR = 'Sign-in failed. Check the email address and password.';

export class SupabaseAuth implements AuthApi {
  private get auth() {
    return supabase().auth;
  }

  private async info(): Promise<SessionInfo | null> {
    const { data } = await this.auth.getSession();
    if (!data.session) return null;
    const aal = await this.auth.mfa.getAuthenticatorAssuranceLevel();
    const needsMfa = aal.data ? aal.data.nextLevel === 'aal2' && aal.data.currentLevel !== 'aal2' : false;
    return { email: data.session.user.email ?? '', needsMfa };
  }

  session() {
    return this.info();
  }

  onChange(cb: (event: string) => void) {
    const { data } = this.auth.onAuthStateChange((event) => cb(event));
    return () => data.subscription.unsubscribe();
  }

  async signIn(email: string, password: string) {
    const { error } = await this.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(GENERIC_LOGIN_ERROR);
    const info = await this.info();
    if (!info) throw new Error(GENERIC_LOGIN_ERROR);
    return info;
  }

  async verifyMfa(code: string) {
    const { data: factors } = await this.auth.mfa.listFactors();
    const totp = factors?.totp?.find((f) => f.status === 'verified');
    if (!totp) throw new Error('No authenticator is set up for this account.');
    const { error } = await this.auth.mfa.challengeAndVerify({ factorId: totp.id, code: code.trim() });
    if (error) throw new Error('The verification code is not valid.');
  }

  async signOut() {
    await this.auth.signOut();
  }

  async requestPasswordReset(email: string, redirectTo: string) {
    // the response is intentionally identical whether or not the address exists
    await this.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  }

  async updatePassword(password: string) {
    const { error } = await this.auth.updateUser({ password });
    if (error) throw new Error('The password could not be changed. Use at least 12 characters.');
  }

  async factors() {
    const { data, error } = await this.auth.mfa.listFactors();
    if (error) throw new Error('Could not load the authenticator settings.');
    return (data?.all ?? []).map((f) => ({ id: f.id, status: f.status, friendly_name: f.friendly_name }));
  }

  async enrollTotp() {
    const { data, error } = await this.auth.mfa.enroll({ factorType: 'totp', friendlyName: `ACAD ${new Date().toISOString().slice(0, 10)}` });
    if (error || !data) throw new Error('Could not start authenticator setup.');
    return { factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret };
  }

  async confirmTotp(factorId: string, code: string) {
    const { error } = await this.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) throw new Error('The verification code is not valid.');
  }

  async unenroll(factorId: string) {
    const { error } = await this.auth.mfa.unenroll({ factorId });
    if (error) throw new Error('Could not remove the authenticator (a verified session may be required).');
  }
}

/** Test-only auth for VITE_DATA_MODE=mock builds (never deployed). */
export class MockAuth implements AuthApi {
  private listeners = new Set<(e: string) => void>();
  private key = 'acad-mock-session';
  private emit(e: string) {
    this.listeners.forEach((cb) => cb(e));
  }
  async session() {
    const email = sessionStorage.getItem(this.key);
    return email ? { email, needsMfa: false } : null;
  }
  onChange(cb: (e: string) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  async signIn(email: string, password: string) {
    if (email.trim() !== 'test@acad.local' || password !== 'test-password-123') throw new Error(GENERIC_LOGIN_ERROR);
    sessionStorage.setItem(this.key, email.trim());
    this.emit('SIGNED_IN');
    return { email: email.trim(), needsMfa: false };
  }
  async verifyMfa() {}
  async signOut() {
    sessionStorage.removeItem(this.key);
    this.emit('SIGNED_OUT');
  }
  async requestPasswordReset() {}
  async updatePassword() {}
  async factors() {
    return [];
  }
  async enrollTotp(): Promise<TotpEnrollment> {
    throw new Error('Not available in test mode.');
  }
  async confirmTotp() {}
  async unenroll() {}
}
