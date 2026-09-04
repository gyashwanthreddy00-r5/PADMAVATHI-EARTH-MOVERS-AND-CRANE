import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLang } from '@/context/LangContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/components/ui/Toast';
import {
  User,
  Lock,
  Loader2,
  Globe,
  Eye,
  EyeOff,
  AlertCircle,
  Settings2,
  X,
  RotateCcw,
} from 'lucide-react';

type BackgroundPreset = 'default' | 'jcb' | 'crane' | 'blueprint' | 'dark' | 'custom';

type LoginBackgroundSettings = {
  preset: BackgroundPreset;
  overlay: number;
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
  leftPosition: string;
  rightPosition: string;
  fit: 'cover' | 'contain';
  customLeft?: string;
  customRight?: string;
};

const DEFAULT_BACKGROUND: LoginBackgroundSettings = {
  preset: 'dark',
  overlay: 33,
  brightness: -7,
  contrast: 5,
  saturation: 5,
  blur: 0,
  leftPosition: 'center',
  rightPosition: 'center',
  fit: 'cover',
};

const STORAGE_KEY = 'padmavathi-login-background';
const JCB_IMAGE = '/assets/login/image.png';
const CRANE_IMAGE = '/assets/login/image copy.png';

function readBackgroundSettings(): LoginBackgroundSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_BACKGROUND;
    const parsed = { ...DEFAULT_BACKGROUND, ...JSON.parse(stored) } as LoginBackgroundSettings;
    return parsed.preset === 'default' ? { ...parsed, preset: 'dark' } : parsed;
  } catch {
    return DEFAULT_BACKGROUND;
  }
}

function getImageFilter(background: LoginBackgroundSettings): string {
  return `brightness(${100 + background.brightness}%) contrast(${100 + background.contrast}%) saturate(${100 + background.saturation}%) blur(${background.blur}px)`;
}

export default function Login() {
  const { signIn } = useAuth();
  const { t, lang, setLang } = useLang();
  const { settings } = useSettings();
  const { show } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [background, setBackground] = useState<LoginBackgroundSettings>(readBackgroundSettings);
  const [draftBackground, setDraftBackground] = useState<LoginBackgroundSettings>(readBackgroundSettings);
  const [showBackgroundSettings, setShowBackgroundSettings] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(background));
  }, [background]);

  const imageFilter = useMemo(() => getImageFilter(background), [background]);
  const leftImage = background.customLeft || JCB_IMAGE;
  const rightImage = background.customRight || CRANE_IMAGE;
  const isBlueprint = background.preset === 'blueprint';
  const isDarkGradient = background.preset === 'dark';
  const showLeftImage = background.preset !== 'crane' && !isBlueprint && !isDarkGradient;
  const showRightImage = background.preset !== 'jcb' && !isBlueprint && !isDarkGradient;
  const overlayOpacity = background.overlay / 100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError(t('required'));
      return;
    }
    setLoading(true);
    setError('');
    const { error: err } = await signIn(username, password);
    setLoading(false);
    if (err) {
      setError(err);
      show(err, 'error');
    } else {
      show(t('loginSuccess'), 'success');
    }
  };

  const updateDraft = <K extends keyof LoginBackgroundSettings>(key: K, value: LoginBackgroundSettings[K]) => {
    setDraftBackground(current => ({ ...current, [key]: value }));
  };

  const applyBackground = () => {
    setBackground(draftBackground);
    setShowBackgroundSettings(false);
  };

  const resetBackground = () => {
    setDraftBackground(DEFAULT_BACKGROUND);
    setBackground(DEFAULT_BACKGROUND);
  };

  const readImageFile = (file: File, key: 'customLeft' | 'customRight') => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      setDraftBackground(current => ({ ...current, preset: 'custom', [key]: value }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className={`relative min-h-screen overflow-hidden flex items-center justify-center p-4 ${isBlueprint ? 'login-blueprint' : ''}`} style={{ backgroundColor: isDarkGradient ? '#071426' : '#0a1628' }}>
      {/* Full-viewport image layers — no black center panel */}
      <div className="absolute inset-0 flex flex-col md:flex-row">
        <div
          className="relative h-[42vh] min-h-[240px] w-full md:h-full md:w-1/2 bg-cover bg-center transition-all duration-500"
          style={
            showLeftImage
              ? {
                  backgroundImage: `url("${leftImage}")`,
                  backgroundPosition: background.leftPosition,
                  backgroundSize: background.fit,
                  filter: imageFilter,
                }
              : undefined
          }
        />
        <div
          className="relative h-[42vh] min-h-[240px] w-full md:h-full md:w-1/2 bg-cover bg-center transition-all duration-500"
          style={
            showRightImage
              ? {
                  backgroundImage: `url("${rightImage}")`,
                  backgroundPosition: background.rightPosition,
                  backgroundSize: background.fit,
                  filter: imageFilter,
                }
              : undefined
          }
        />
      </div>
      {/* Subtle transparent center readability gradient — images stay visible */}
      <div
        className="pointer-events-none absolute inset-0 transition-all duration-500"
        style={{
          background: isDarkGradient
            ? 'linear-gradient(135deg, rgba(7,20,38,0.85) 0%, rgba(16,44,75,0.75) 50%, rgba(7,20,38,0.85) 100%)'
            : isBlueprint
              ? 'linear-gradient(rgba(9,35,61,0.88), rgba(9,35,61,0.88))'
              : `linear-gradient(to right, rgba(5,15,30,${overlayOpacity * 0.15}) 0%, rgba(5,15,30,${overlayOpacity * 0.35}) 35%, rgba(5,15,30,${overlayOpacity * 0.5}) 50%, rgba(5,15,30,${overlayOpacity * 0.35}) 65%, rgba(5,15,30,${overlayOpacity * 0.15}) 100%)`,
        }}
      />

      <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
        <button
          onClick={() => {
            setDraftBackground(background);
            setShowBackgroundSettings(current => !current);
          }}
          aria-label="Background settings"
          className="flex items-center justify-center w-9 h-9 text-white/85 hover:text-white border border-white/20 rounded-lg hover:bg-white/10 transition-colors"
        >
          <Settings2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => setLang(lang === 'en' ? 'te' : 'en')}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-white/80 hover:text-white border border-white/20 rounded-lg hover:bg-white/10 transition-colors"
        >
          <Globe className="w-4 h-4" />
          {lang === 'en' ? 'తెలుగు' : 'English'}
        </button>
      </div>

      {showBackgroundSettings && (
        <div className="absolute top-16 right-4 z-40 w-[min(360px,calc(100vw-32px))] max-h-[calc(100vh-80px)] overflow-y-auto rounded-2xl border border-white/15 bg-slate-950/95 p-5 text-white shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold">Background settings</h2>
              <p className="text-xs text-white/50 mt-0.5">Personalize the login photos</p>
            </div>
            <button onClick={() => setShowBackgroundSettings(false)} className="text-white/60 hover:text-white transition-colors" aria-label="Close background settings">
              <X className="w-4 h-4" />
            </button>
          </div>

          <label className="block text-xs text-white/70 mb-1.5">Background preset</label>
          <select
            value={draftBackground.preset}
            onChange={e => updateDraft('preset', e.target.value as BackgroundPreset)}
            className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40"
          >
            <option value="default" className="text-slate-900">JCB + Crane</option>
            <option value="jcb" className="text-slate-900">JCB Only</option>
            <option value="crane" className="text-slate-900">Crane Only</option>
            <option value="blueprint" className="text-slate-900">Blueprint</option>
            <option value="dark" className="text-slate-900">Dark Blue Gradient</option>
            <option value="custom" className="text-slate-900">Custom Background</option>
          </select>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <label className="text-xs text-white/70">Left image
              <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && readImageFile(e.target.files[0], 'customLeft')} className="mt-1.5 block w-full text-[10px] text-white/60 file:mr-2 file:rounded file:border-0 file:bg-white/15 file:px-2 file:py-1 file:text-[10px] file:text-white" />
            </label>
            <label className="text-xs text-white/70">Right image
              <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && readImageFile(e.target.files[0], 'customRight')} className="mt-1.5 block w-full text-[10px] text-white/60 file:mr-2 file:rounded file:border-0 file:bg-white/15 file:px-2 file:py-1 file:text-[10px] file:text-white" />
            </label>
          </div>

          <div className="space-y-3 mt-5">
            <RangeControl label="Overlay opacity" value={draftBackground.overlay} min={0} max={70} suffix="%" onChange={value => updateDraft('overlay', value)} />
            <RangeControl label="Brightness" value={draftBackground.brightness} min={-30} max={20} suffix="%" onChange={value => updateDraft('brightness', value)} />
            <RangeControl label="Contrast" value={draftBackground.contrast} min={-20} max={30} suffix="%" onChange={value => updateDraft('contrast', value)} />
            <RangeControl label="Saturation" value={draftBackground.saturation} min={-30} max={30} suffix="%" onChange={value => updateDraft('saturation', value)} />
            <RangeControl label="Blur" value={draftBackground.blur} min={0} max={4} suffix="px" onChange={value => updateDraft('blur', value)} />
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <PositionControl label="Left image position" value={draftBackground.leftPosition} onChange={value => updateDraft('leftPosition', value)} />
            <PositionControl label="Right image position" value={draftBackground.rightPosition} onChange={value => updateDraft('rightPosition', value)} />
          </div>

          <label className="block text-xs text-white/70 mt-4">Image fit
            <select value={draftBackground.fit} onChange={e => updateDraft('fit', e.target.value as 'cover' | 'contain')} className="mt-1.5 w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40">
              <option value="cover" className="text-slate-900">Cover</option>
              <option value="contain" className="text-slate-900">Contain</option>
            </select>
          </label>

          <div className="flex gap-2 mt-5">
            <button onClick={resetBackground} className="flex items-center justify-center gap-1.5 flex-1 rounded-lg border border-white/20 px-3 py-2 text-xs text-white/80 hover:bg-white/10 transition-colors">
              <RotateCcw className="w-3.5 h-3.5" /> Reset to default
            </button>
            <button onClick={applyBackground} className="flex-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-white/90 transition-colors">
              Apply
            </button>
          </div>
        </div>
      )}

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white rounded-2xl shadow-lg shadow-blue-600/30 mb-4 p-2">
            <img src={settings?.logo_url ?? '/coreone.png'} alt="Logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-xl font-bold text-white leading-tight" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>{settings?.company_name ?? t('appName')}</h1>
          <p className="text-sm text-blue-200/80 mt-1" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{t('appTagline')}</p>
        </div>

        <div className="rounded-2xl shadow-2xl p-8" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.45)' }}>
          <h2 className="text-xl font-semibold text-slate-800 mb-1">{t('welcomeBack')}</h2>
          <p className="text-sm text-slate-500 mb-6">{t('signInToContinue')}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">{t('username')}</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="admin" autoComplete="username" autoCapitalize="none" autoCorrect="off" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">{t('password')}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} className="w-full pl-10 pr-10 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" placeholder="••••••••" autoComplete="current-password" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors" tabIndex={-1}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <button type="button" className="text-xs text-blue-600 hover:text-blue-700 hover:underline">{t('forgotPassword')}</button>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={loading} className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('loading')}</> : t('login')}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-white/60 mt-6" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{settings?.company_name ?? t('appName')} © {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}

type RangeControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
};

function RangeControl({ label, value, min, max, suffix, onChange }: RangeControlProps) {
  return (
    <label className="block text-xs text-white/70">
      <span className="flex justify-between mb-1"><span>{label}</span><span className="text-white/90">{value}{suffix}</span></span>
      <input type="range" value={value} min={min} max={max} onChange={e => onChange(Number(e.target.value))} className="w-full accent-white" />
    </label>
  );
}

type PositionControlProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function PositionControl({ label, value, onChange }: PositionControlProps) {
  return (
    <label className="block text-xs text-white/70">{label}
      <select value={value} onChange={e => onChange(e.target.value)} className="mt-1.5 w-full rounded-lg border border-white/15 bg-white/10 px-2 py-2 text-xs text-white outline-none focus:border-white/40">
        <option value="left" className="text-slate-900">Left</option>
        <option value="center" className="text-slate-900">Center</option>
        <option value="right" className="text-slate-900">Right</option>
      </select>
    </label>
  );
}
