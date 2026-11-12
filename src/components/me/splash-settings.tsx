import { useEffect, useState } from 'react';
import { KButton, KOpt, KOpts } from '@/components/ui-kit';
import { useApp } from '@/lib/store';
import { requestSplashPreview, splashMotionEnabled } from '@/lib/splash-policy';
export function SplashSettings() {
  const motion = useApp(s => s.settings.motion ?? 'auto');
  const [systemReduced, setSystemReduced] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setSystemReduced(media.matches);
    sync(); media.addEventListener('change', sync); return () => media.removeEventListener('change', sync);
  }, []);
  const allowed = splashMotionEnabled(motion, systemReduced);
  return <section className="k-card k-sub" aria-label="开屏动画设置">
    <div className="k-sect"><h2 className="k-sect__title">开屏动画</h2></div>
    <div className="flex flex-col gap-3">
      <p className="k-row__meta">冷启动距上次播放满一小时，或离开后台满一小时后返回时播放。短暂切换不重播，播放时可以跳过。</p>
      <p className="k-row__title">全局动效</p>
      <KOpts cols={3}>{([['on','始终开启'],['auto','跟随系统'],['off','关闭']] as const).map(([value, label]) =>
        <KOpt key={value} active={motion === value} aria-pressed={motion === value} onClick={() => useApp.getState().patchSettings({ motion: value })}>{label}</KOpt>)}</KOpts>
      <p className="k-row__meta">与栖岛其他动画共用同一个开关。</p>
      <KButton disabled={!allowed} onClick={() => { if (requestSplashPreview(motion)) setMessage('本次重播不影响自动开屏的一小时间隔。'); }}>重播开屏动画</KButton>
      {!allowed && <p className="k-row__meta">{motion === 'off' ? '全局动效已关闭。' : '当前跟随系统的减少动态设置。'} 开启动效后可以预览。</p>}
      {message && <p className="k-row__meta" role="status">{message}</p>}
    </div>
  </section>;
}
