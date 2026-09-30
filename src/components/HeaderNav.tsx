import React from 'react';
import { Flame, LogOut } from 'lucide-react';
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
    <header className="relative z-30 w-full border-b border-emerald-500/25 bg-slate-950/70 backdrop-blur-xl shadow-lg shadow-emerald-950/20 glass-panel">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 md:px-10 lg:px-12 xl:px-16 h-15 flex items-center justify-between">
        {/* Logo & Clinical Title */}
        <div className="flex items-center gap-3">
          <img
            src="/brand/neuroscope-logo.png"
            alt="NeuroScope logo"
            className="w-9 h-9 sm:w-10 sm:h-10 object-contain drop-shadow-[0_0_10px_rgba(45,212,191,0.55)] shrink-0"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base md:text-lg tracking-tight bg-gradient-to-r from-white via-emerald-100 to-amber-300 bg-clip-text text-transparent">
                NeuroScope
              </span>
            </div>
            <p className="text-[11px] text-emerald-200/80 hidden sm:block">
              Mental Wellness Evaluation and Solution
            </p>
          </div>
        </div>

        {/* Status Pill */}
        <div className="flex items-center gap-2 sm:gap-3 text-xs font-medium">
          <LanguageSwitcher />
          <OfflineModelMenu />
          <span className="hidden md:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-[11px] font-semibold shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
            Biopsychosocial Active
          </span>

          {user && (
            <>
              {/* Daily login streak */}
              <div className="hidden sm:flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 px-2.5 sm:px-3 py-1.5 rounded-2xl">
                <Flame className="w-3.5 h-3.5 text-orange-400" />
                <span className="font-bold text-white font-mono text-[11px]">{loginStreak ?? 0}</span>
                <span className="text-slate-400 text-[10px]">day streak</span>
              </div>

              {/* User chip */}
              <div className="flex items-center gap-2 pl-1">
                {user.picture ? (
                  <img
                    src={user.picture}
                    alt={user.name}
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-full border border-emerald-400/40 object-cover"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-emerald-500/40 to-amber-500/40 border border-emerald-400/40 flex items-center justify-center text-[11px] font-bold text-white">
                    {user.name.trim().charAt(0).toUpperCase() || 'U'}
                  </div>
                )}
                <span className="hidden lg:inline text-[11px] text-slate-300 max-w-[120px] truncate">
                  {user.name}
                </span>
                <button
                  type="button"
                  onClick={onSignOut}
                  title="Sign out"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
