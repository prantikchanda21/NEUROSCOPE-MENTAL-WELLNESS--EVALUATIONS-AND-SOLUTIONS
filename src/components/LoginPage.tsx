import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Lock, User as UserIcon, Eye, EyeOff, ShieldCheck, LogIn, UserPlus } from 'lucide-react';
import {
  createAccountWithEmail,
  signInWithEmail,
  signInWithGoogleProfile,
  PublicUser,
} from '../utils/authStorage';
import { renderGoogleButton } from '../utils/googleAuth';

interface LoginPageProps {
  onAuthenticated: (user: PublicUser) => void;
}

type Mode = 'signin' | 'signup';

export const LoginPage: React.FC<LoginPageProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [googleNotice, setGoogleNotice] = useState<string | null>(null);

  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!googleButtonRef.current) return;
    renderGoogleButton(
      googleButtonRef.current,
      (profile) => {
        const user = signInWithGoogleProfile(profile);
        onAuthenticated(user);
      },
      (message) => setGoogleNotice(message)
    );
    // Re-render only once on mount; the widget manages its own click handling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result =
        mode === 'signup'
          ? await createAccountWithEmail(name, email, password)
          : await signInWithEmail(email, password);

      if ('error' in result) {
        setError(result.error);
      } else {
        onAuthenticated(result.user);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-[440px] mx-auto">
      <motion.div
        key={mode}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative rounded-3xl bg-slate-900/85 backdrop-blur-2xl p-6 sm:p-8 shadow-xl space-y-6 glass-panel border border-emerald-500/20"
      >
        {/* Brand header */}
        <div className="flex flex-col items-center text-center gap-2.5">
          <img
            src="/brand/neuroscope-logo.png"
            alt="NeuroScope logo"
            className="w-14 h-14 object-contain drop-shadow-[0_0_14px_rgba(45,212,191,0.6)]"
          />
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight bg-gradient-to-r from-white via-emerald-100 to-amber-300 bg-clip-text text-transparent">
            {mode === 'signin' ? 'Welcome Back' : 'Create Your Account'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-[320px]">
            {mode === 'signin'
              ? 'Sign in to pick up right where you left off — your reports and daily streak are waiting.'
              : 'Save your reports and build a daily check-in streak as you use NeuroScope.'}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center p-1 rounded-2xl bg-slate-950/70 border border-slate-800">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              mode === 'signin'
                ? 'bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            Sign In
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              mode === 'signup'
                ? 'bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Create Account
          </button>
        </div>

        {/* Google sign-in */}
        <div className="space-y-2">
          <div ref={googleButtonRef} className="w-full flex justify-center min-h-[42px]" />
          {googleNotice && (
            <p className="text-[11px] text-slate-500 text-center">{googleNotice}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-800" />
          <span className="text-[11px] text-slate-500 uppercase tracking-wider">or continue with email</span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>

        {/* Email / password form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <AnimatePresence mode="popLayout" initial={false}>
            {mode === 'signup' && (
              <motion.div
                key="name-field"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    required={mode === 'signup'}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-sm text-white placeholder:text-slate-500 transition-all"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative">
            <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-sm text-white placeholder:text-slate-500 transition-all"
            />
          </div>

          <div className="relative">
            <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              minLength={6}
              className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-sm text-white placeholder:text-slate-500 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <AnimatePresence mode="popLayout" initial={false}>
            {mode === 'signup' && (
              <motion.div
                key="confirm-field"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    autoComplete="new-password"
                    required={mode === 'signup'}
                    minLength={6}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-sm text-white placeholder:text-slate-500 transition-all"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 disabled:opacity-60 disabled:cursor-not-allowed text-slate-950 font-extrabold text-sm shadow-xl shadow-cyan-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {isSubmitting ? (
              <span>{mode === 'signin' ? 'Signing in…' : 'Creating account…'}</span>
            ) : (
              <>
                {mode === 'signin' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                <span>{mode === 'signin' ? 'Sign In' : 'Create Account'}</span>
              </>
            )}
          </button>
        </form>

        <div className="text-[11px] text-slate-500 text-center">
          {mode === 'signin' ? (
            <>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer"
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer"
              >
                Sign in
              </button>
            </>
          )}
        </div>

        <div className="text-[11px] text-slate-500 flex items-center justify-center gap-2 pt-1 border-t border-slate-800/80">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-2" />
          <span className="pt-2">Your reports and login streak are saved to this account.</span>
        </div>
      </motion.div>
    </div>
  );
};
