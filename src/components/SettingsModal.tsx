import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlignJustify,
  Check,
  ChevronDown,
  Coffee,
  LayoutGrid,
  Moon,
  RefreshCw,
  Rows3,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import type {
  FeedDensity,
  FontOption,
  NitterInstanceHealth,
  SortOption,
  SourceFilter,
  ThemeOption,
  TimeframeOption,
} from '../types/reddit';

interface SettingsModalProps {
  isOpen: boolean;
  sort: SortOption;
  timeframe: TimeframeOption;
  sourceFilter: SourceFilter;
  density: FeedDensity;
  theme: ThemeOption;
  font: FontOption;
  savedCount: number;
  loading: boolean;
  activeNitterInstance: string | null;
  nitterInstances: NitterInstanceHealth[];
  checkingNitterHealth: boolean;
  switchingNitterInstance: boolean;
  onChangeSort: (sort: SortOption) => void;
  onChangeTimeframe: (tf: TimeframeOption) => void;
  onChangeSourceFilter: (source: SourceFilter) => void;
  onChangeDensity: (density: FeedDensity) => void;
  onChangeTheme: (theme: ThemeOption) => void;
  onChangeFont: (font: FontOption) => void;
  onRefreshNitterHealth: () => void;
  onSelectNitterInstance: (instanceUrl: string) => void;
  onRefreshFeed: () => void;
  onClearCache: () => void;
  onClearSaved: () => void;
  onClose: () => void;
}

interface DropdownOption<T extends string> {
  value: T;
  label: string;
  meta?: string;
  previewClass?: string;
  swatchClass?: string;
  Icon?: React.ComponentType<{ className?: string }>;
}

const THEME_OPTIONS: DropdownOption<ThemeOption>[] = [
  { value: 'dark', label: 'Dark', Icon: Moon, swatchClass: 'bg-[#09090B] ring-1 ring-zinc-600' },
  { value: 'light', label: 'Light', Icon: Sun, swatchClass: 'bg-[#FAFAFA] ring-1 ring-zinc-300' },
  {
    value: 'mocha',
    label: 'Catppuccin Mocha',
    Icon: Coffee,
    swatchClass: 'bg-gradient-to-br from-[#1e1e2e] via-[#313244] to-[#cba6f7]',
  },
  {
    value: 'glass',
    label: 'Glassmorphism',
    Icon: Sparkles,
    swatchClass: 'bg-gradient-to-br from-[#38bdf8] via-[#6366f1] to-[#a855f7]',
  },
];

const FONT_OPTIONS: DropdownOption<FontOption>[] = [
  { value: 'geist-mono', label: 'Geist Mono', meta: 'Mono', previewClass: 'font-preview-geist-mono' },
  { value: 'geist', label: 'Geist', meta: 'Sans', previewClass: 'font-preview-geist' },
  { value: 'inter', label: 'Inter', meta: 'Sans', previewClass: 'font-preview-inter' },
  { value: 'jakarta', label: 'Plus Jakarta', meta: 'Sans', previewClass: 'font-preview-jakarta' },
  { value: 'space-grotesk', label: 'Space Grotesk', meta: 'Sans', previewClass: 'font-preview-space-grotesk' },
  { value: 'jetbrains-mono', label: 'JetBrains Mono', meta: 'Mono', previewClass: 'font-preview-jetbrains-mono' },
];

const SORT_OPTIONS: DropdownOption<SortOption>[] = [
  { value: 'best', label: 'Best' },
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
  { value: 'top', label: 'Top' },
  { value: 'rising', label: 'Rising' },
  { value: 'controversial', label: 'Controversial' },
];

const TIMEFRAME_OPTIONS: DropdownOption<TimeframeOption>[] = [
  { value: 'hour', label: 'Past Hour' },
  { value: 'day', label: 'Past Day' },
  { value: 'week', label: 'Past Week' },
  { value: 'month', label: 'Past Month' },
  { value: 'year', label: 'Past Year' },
  { value: 'all', label: 'All Time' },
];

const LAYOUT_OPTIONS: DropdownOption<FeedDensity>[] = [
  { value: 'comfortable', label: 'List', Icon: Rows3 },
  { value: 'compact', label: 'Compact', Icon: AlignJustify },
  { value: 'card', label: 'Cards', Icon: LayoutGrid },
];

const SOURCE_OPTIONS: DropdownOption<SourceFilter>[] = [
  { value: 'all', label: 'All Feeds' },
  { value: 'reddit', label: 'Reddit (r/)' },
  { value: 'x', label: 'X (@)' },
];

type MenuKey = 'theme' | 'font' | 'sort' | 'timeframe' | 'layout' | 'source' | 'nitter';

function getHealthDotClass(status: NitterInstanceHealth['status']): string {
  switch (status) {
    case 'healthy':
      return 'bg-emerald-500';
    case 'degraded':
      return 'bg-amber-400';
    case 'down':
      return 'bg-red-500';
    default:
      return 'bg-zinc-400';
  }
}

function getHealthMetaLabel(inst: NitterInstanceHealth): string {
  if (inst.status === 'down') return 'Down';
  if (inst.latencyMs != null) return `${inst.latencyMs}ms`;
  return inst.status === 'degraded' ? 'Limited' : 'Unchecked';
}

interface SettingDropdownRowProps<T extends string> {
  id: MenuKey;
  label: string;
  description?: string;
  value: T;
  options: DropdownOption<T>[];
  isOpen: boolean;
  openUpward?: boolean;
  onToggle: (id: MenuKey) => void;
  onSelect: (value: T) => void;
}

function SettingDropdownRow<T extends string>({
  id,
  label,
  description,
  value,
  options,
  isOpen,
  openUpward = false,
  onToggle,
  onSelect,
}: SettingDropdownRowProps<T>) {
  const selected = options.find((o) => o.value === value) ?? options[0];
  const SelectedIcon = selected.Icon;

  return (
    <div className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-[var(--sf-text)]">
          {label}
        </div>
        {description && (
          <p className="mt-0.5 text-[11px] text-[var(--sf-text-muted)] truncate">
            {description}
          </p>
        )}
      </div>

      <div
        data-settings-dropdown={id}
        className="relative shrink-0 w-full sm:w-[206px]"
      >
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={label}
          className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] rounded-md border transition-colors bg-[var(--sf-surface)] text-[var(--sf-text)] glass:backdrop-blur-md ${
            isOpen
              ? 'border-[var(--sf-border-strong)]'
              : 'border-[var(--sf-border)] hover:border-[var(--sf-border-strong)]'
          }`}
        >
          <span className="flex items-center gap-2 min-w-0 truncate">
            {selected.swatchClass ? (
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${selected.swatchClass}`}
                aria-hidden="true"
              />
            ) : SelectedIcon ? (
              <SelectedIcon className="w-3.5 h-3.5 shrink-0 text-[var(--sf-text-muted)]" />
            ) : null}
            <span className={`truncate ${selected.previewClass ?? ''}`}>
              {selected.label}
            </span>
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 text-[var(--sf-text-muted)] transition-transform duration-150 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.ul
              role="listbox"
              aria-label={label}
              initial={{ opacity: 0, y: openUpward ? 4 : -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: openUpward ? 4 : -4, scale: 0.98 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              className={`absolute right-0 z-30 w-full py-1 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-elevated)] shadow-xl max-h-60 overflow-y-auto glass:backdrop-blur-2xl glass:shadow-[0_16px_44px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.14)] ${
                openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
              }`}
            >
              {options.map((opt) => {
                const active = opt.value === value;
                const OptIcon = opt.Icon;
                return (
                  <li key={opt.value} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => onSelect(opt.value)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] transition-colors text-left ${
                        active
                          ? 'bg-[var(--sf-active)] text-[var(--sf-text)] font-medium'
                          : 'text-[var(--sf-text-secondary)] hover:bg-[var(--sf-hover)] hover:text-[var(--sf-text)]'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0 truncate">
                        {opt.swatchClass ? (
                          <span
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${opt.swatchClass}`}
                            aria-hidden="true"
                          />
                        ) : OptIcon ? (
                          <OptIcon className="w-3.5 h-3.5 shrink-0 text-[var(--sf-text-muted)]" />
                        ) : null}
                        <span className={`truncate ${opt.previewClass ?? ''}`}>
                          {opt.label}
                        </span>
                      </span>

                      <span className="flex items-center gap-1.5 shrink-0">
                        {opt.meta && (
                          <span className="text-[10.5px] text-[var(--sf-text-muted)]">
                            {opt.meta}
                          </span>
                        )}
                        {active && (
                          <Check className="w-3.5 h-3.5 text-[var(--sf-accent)]" />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function SettingsModal({
  isOpen,
  sort,
  timeframe,
  sourceFilter,
  density,
  theme,
  font,
  savedCount,
  loading,
  activeNitterInstance,
  nitterInstances,
  checkingNitterHealth,
  switchingNitterInstance,
  onChangeSort,
  onChangeTimeframe,
  onChangeSourceFilter,
  onChangeDensity,
  onChangeTheme,
  onChangeFont,
  onRefreshNitterHealth,
  onSelectNitterInstance,
  onRefreshFeed,
  onClearCache,
  onClearSaved,
  onClose,
}: SettingsModalProps) {
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [cacheCleared, setCacheCleared] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setOpenMenu(null);
      return;
    }

    const handleMouseDown = (e: MouseEvent) => {
      if (!openMenu) return;
      const target = e.target as HTMLElement | null;
      const closestDropdown = target?.closest('[data-settings-dropdown]');
      if (closestDropdown?.getAttribute('data-settings-dropdown') !== openMenu) {
        setOpenMenu(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openMenu) {
        e.stopPropagation();
        setOpenMenu(null);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, openMenu]);

  if (!isOpen) return null;

  const isTimeframeActive = sort === 'top' || sort === 'controversial';

  const toggleMenu = (id: MenuKey) => {
    setOpenMenu((prev) => (prev === id ? null : id));
  };

  const handleClearCache = () => {
    onClearCache();
    setCacheCleared(true);
    setTimeout(() => setCacheCleared(false), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 dark:bg-black/65 glass:bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Surface */}
      <div className="relative z-10 w-full max-w-[460px] max-h-[90dvh] flex flex-col bg-[var(--sf-modal)] border border-[var(--sf-border)] rounded-xl shadow-2xl glass:backdrop-blur-2xl glass:shadow-[0_24px_80px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.16)]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--sf-border)] flex items-center justify-between gap-4 shrink-0">
          <h2 className="text-[14px] font-semibold text-[var(--sf-text)]">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 -mr-1 text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)] rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Compact Dropdown Rows */}
        <div className="px-5 py-1.5 divide-y divide-[var(--sf-border-subtle)] overflow-y-auto">
          <SettingDropdownRow
            id="theme"
            label="Appearance"
            description="Theme palette"
            value={theme}
            options={THEME_OPTIONS}
            isOpen={openMenu === 'theme'}
            onToggle={toggleMenu}
            onSelect={(val) => {
              onChangeTheme(val);
              setOpenMenu(null);
            }}
          />

          <SettingDropdownRow
            id="font"
            label="Typography"
            description="Reading & UI font"
            value={font}
            options={FONT_OPTIONS}
            isOpen={openMenu === 'font'}
            onToggle={toggleMenu}
            onSelect={(val) => {
              onChangeFont(val);
              setOpenMenu(null);
            }}
          />

          <SettingDropdownRow
            id="sort"
            label="Default Sort"
            description="Applied across feeds"
            value={sort}
            options={SORT_OPTIONS}
            isOpen={openMenu === 'sort'}
            onToggle={toggleMenu}
            onSelect={(val) => {
              onChangeSort(val);
              setOpenMenu(null);
            }}
          />

          <SettingDropdownRow
            id="timeframe"
            label="Timeframe"
            description={isTimeframeActive ? 'Active for current sort' : 'Top & Controversial'}
            value={timeframe}
            options={TIMEFRAME_OPTIONS}
            isOpen={openMenu === 'timeframe'}
            openUpward
            onToggle={toggleMenu}
            onSelect={(val) => {
              onChangeTimeframe(val);
              setOpenMenu(null);
            }}
          />

          <SettingDropdownRow
            id="layout"
            label="Feed Layout"
            description="Display density"
            value={density}
            options={LAYOUT_OPTIONS}
            isOpen={openMenu === 'layout'}
            openUpward
            onToggle={toggleMenu}
            onSelect={(val) => {
              onChangeDensity(val);
              setOpenMenu(null);
            }}
          />

          <SettingDropdownRow
            id="source"
            label="All Feeds Source"
            description="Combined view filter"
            value={sourceFilter}
            options={SOURCE_OPTIONS}
            isOpen={openMenu === 'source'}
            openUpward
            onToggle={toggleMenu}
            onSelect={(val) => {
              onChangeSourceFilter(val);
              setOpenMenu(null);
            }}
          />

          {/* Nitter Instance Health & Switcher Row */}
          {(() => {
            const activeRec =
              nitterInstances.find((i) => i.url === activeNitterInstance) ||
              nitterInstances.find((i) => i.isActive) ||
              nitterInstances[0] ||
              null;
            const healthyCount = nitterInstances.filter((i) => i.status === 'healthy').length;
            const summaryText = checkingNitterHealth
              ? 'Checking instances...'
              : nitterInstances.length > 0
                ? `${healthyCount}/${nitterInstances.length} healthy`
                : 'Auto-monitored X mirror';

            return (
              <div className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-[var(--sf-text)]">
                    Nitter Instance
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--sf-text-muted)] truncate">
                    {summaryText}
                  </p>
                </div>

                <div
                  data-settings-dropdown="nitter"
                  className="relative shrink-0 w-full sm:w-[206px] flex items-center gap-1.5"
                >
                  <button
                    type="button"
                    onClick={() => toggleMenu('nitter')}
                    disabled={switchingNitterInstance}
                    aria-haspopup="listbox"
                    aria-expanded={openMenu === 'nitter'}
                    aria-label="Nitter Instance"
                    className={`flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] rounded-md border transition-colors bg-[var(--sf-surface)] text-[var(--sf-text)] glass:backdrop-blur-md disabled:opacity-60 ${
                      openMenu === 'nitter'
                        ? 'border-[var(--sf-border-strong)]'
                        : 'border-[var(--sf-border)] hover:border-[var(--sf-border-strong)]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0 truncate">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          activeRec ? getHealthDotClass(activeRec.status) : 'bg-zinc-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="truncate font-mono text-[11.5px]">
                        {switchingNitterInstance
                          ? 'Switching...'
                          : activeRec?.host || 'Auto'}
                      </span>
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 shrink-0 text-[var(--sf-text-muted)] transition-transform duration-150 ${
                        openMenu === 'nitter' ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={onRefreshNitterHealth}
                    disabled={checkingNitterHealth}
                    title="Re-check Nitter instance health"
                    aria-label="Re-check Nitter instance health"
                    className="p-1.5 rounded-md border border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:border-[var(--sf-border-strong)] transition-colors disabled:opacity-50 shrink-0"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${checkingNitterHealth ? 'animate-spin' : ''}`}
                    />
                  </button>

                  <AnimatePresence>
                    {openMenu === 'nitter' && (
                      <motion.ul
                        role="listbox"
                        aria-label="Nitter instances"
                        initial={{ opacity: 0, y: 4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.98 }}
                        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                        className="absolute right-0 bottom-full mb-1.5 z-30 w-full min-w-[230px] py-1 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-elevated)] shadow-xl max-h-60 overflow-y-auto glass:backdrop-blur-2xl glass:shadow-[0_16px_44px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.14)]"
                      >
                        {nitterInstances.length === 0 ? (
                          <li className="px-3 py-2 text-[11.5px] text-[var(--sf-text-muted)]">
                            {checkingNitterHealth ? 'Probing instances...' : 'No instances loaded'}
                          </li>
                        ) : (
                          nitterInstances.map((inst) => {
                            const active = inst.url === activeRec?.url;
                            return (
                              <li key={inst.url} role="option" aria-selected={active}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onSelectNitterInstance(inst.url);
                                    setOpenMenu(null);
                                  }}
                                  className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[11.5px] transition-colors text-left ${
                                    active
                                      ? 'bg-[var(--sf-active)] text-[var(--sf-text)] font-medium'
                                      : 'text-[var(--sf-text-secondary)] hover:bg-[var(--sf-hover)] hover:text-[var(--sf-text)]'
                                  }`}
                                >
                                  <span className="flex items-center gap-2 min-w-0 truncate">
                                    <span
                                      className={`w-2 h-2 rounded-full shrink-0 ${getHealthDotClass(
                                        inst.status
                                      )}`}
                                      aria-hidden="true"
                                    />
                                    <span className="truncate font-mono">{inst.host}</span>
                                  </span>

                                  <span className="flex items-center gap-1.5 shrink-0">
                                    <span
                                      className={`text-[10.5px] tabular-nums ${
                                        inst.status === 'down'
                                          ? 'text-red-500 dark:text-red-400 mocha:text-[#f38ba8]'
                                          : 'text-[var(--sf-text-muted)]'
                                      }`}
                                    >
                                      {getHealthMetaLabel(inst)}
                                    </span>
                                    {active && (
                                      <Check className="w-3.5 h-3.5 text-[var(--sf-accent)]" />
                                    )}
                                  </span>
                                </button>
                              </li>
                            );
                          })
                        )}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Feed Data Footer */}
        <div className="px-5 py-3.5 border-t border-[var(--sf-border)] flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              onRefreshFeed();
              onClose();
            }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] bg-[var(--sf-surface)] border border-[var(--sf-border)] hover:border-[var(--sf-border-strong)] rounded-md transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleClearCache}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] bg-[var(--sf-surface)] border border-[var(--sf-border)] hover:border-[var(--sf-border-strong)] rounded-md transition-colors whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{cacheCleared ? 'Cleared' : 'Clear cache'}</span>
          </button>

          {savedCount > 0 && (
            <button
              type="button"
              onClick={onClearSaved}
              className="ml-auto px-3 py-1.5 text-[12px] text-red-600 dark:text-red-400 mocha:text-[#f38ba8] bg-[var(--sf-surface)] border border-[var(--sf-border)] hover:border-red-400 dark:hover:border-red-500/60 mocha:hover:border-[#f38ba8]/60 rounded-md transition-colors whitespace-nowrap"
            >
              Clear saved ({savedCount})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
