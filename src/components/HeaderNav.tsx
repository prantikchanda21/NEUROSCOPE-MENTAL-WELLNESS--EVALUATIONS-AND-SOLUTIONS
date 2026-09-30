import React from 'react';
import { ChevronDown, Flame, LogOut, ShieldCheck } from 'lucide-react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { OfflineModelMenu } from './OfflineModelMenu';
import { PublicUser } from '../utils/authStorage';

interface HeaderNavProps {
  isMuted?: boolean;
  onToggleMute?: () => void;
  user?: PublicUser | null;
  loginStreak?: number;
  onSignOut?: () => void;
}

export const HeaderNav: React.FC<HeaderNavProps> = ({ user, loginStreak, onSignOut }) => {
  return (
    <header className="mobile-app-header sticky top-0 z-50 w-full border-b border-slate-200/90 bg-white/90 shadow-[0_8px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1800px] items-center justify-between gap-3 px-4 sm:h-[4.5rem] sm:px-6 md:px-10 lg:px-12 xl:px-16">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <img
            src="/brand/neuroscope-logo.png"
            alt="NeuroScope logo"
            className="h-9 w-9 shrink-0 rounded-xl object-contain sm:h-10 sm:w-10"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-extrabold tracking-tight text-slate-950 md:text-lg">NeuroScope</span>
              <span className="hidden items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-extrabold uppercase tracking-wider text-emerald-700 sm:inline-flex">
                <ShieldCheck className="h-3 w-3" />
                Private
              </span>
            </div>
            <p className="hidden text-[11px] font-semibold text-slate-500 sm:block">Mental wellness check-in</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
          {user && (
            <div className="hidden items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1.5 sm:flex">
              <Flame className="h-3.5 w-3.5 text-orange-500" />
              <span className="font-mono text-[11px] font-extrabold text-slate-800">{loginStreak ?? 0}</span>
              <span className="text-[10px] font-semibold text-slate-500">day streak</span>
            </div>
          )}

          <LanguageSwitcher />
          <OfflineModelMenu />

          {user && (
            <div className="flex items-center gap-1.5 pl-0.5">
              {user.picture ? (
                <img
                  src={user.picture}
                  alt={user.name}
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 rounded-full border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-[11px] font-extrabold text-white">
                  {user.name.trim().charAt(0).toUpperCase() || 'U'}
                </div>
              )}
              <span className="hidden max-w-[120px] truncate text-[11px] font-semibold text-slate-600 lg:inline">{user.name}</span>
              <button
                type="button"
                onClick={onSignOut}
                title="Sign out"
                aria-label="Sign out"
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-rose-500"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto border-t border-slate-100 px-4 py-2 sm:hidden">
        <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1.5 text-[10px] font-extrabold text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          On-device safety
        </div>
        {user && (
          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-1.5 text-[10px] font-extrabold text-orange-700">
            <Flame className="h-3 w-3" />
            {loginStreak ?? 0} day streak
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1 text-[10px] font-bold text-slate-400">
          <ChevronDown className="h-3 w-3" />
          Swipe to explore tools
        </div>
      </div>
    </header>
  );
};
