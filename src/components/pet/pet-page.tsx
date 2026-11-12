import { KSwitch } from '@/components/ui-kit/k-switch';
import { PetChoice } from './pet-choice';
import { LEXICON } from '@/plugins/emotion-lifeform/lib/emotion/lexicon';
import { GESTURE_HINTS } from './pet-emotion';
import { useRef, useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { ChatCrab } from '@/components/chat/chat-crab';
import { chatCrabSize } from '@/lib/chat-crab-settings';
import { useApp } from '@/lib/store';
import type { PetAction } from './pet-life';
const ACTIONS: { id: PetAction; title: string; description: string }[] = [
  { id: 'auto', title: '自由活动', description: '自己寻找落脚点，在聊天气泡间走跳。' },
  { id: 'walk', title: '散步', description: '横着迈腿，停下来张望，再接着走。' },
  { id: 'jump', title: '跳气泡', description: '蹲下蓄力、起跳收腿、落地站稳。' },
  { id: 'poke', title: '摸摸它', description: '小跳起来举钳，冒出一句短话。' },
  { id: 'think', title: '想一想', description: '歪身抬钳，像在琢磨事情。' },
  { id: 'work', title: '小电脑', description: '掏出电脑、敲键盘；切回自由活动时收好。' },
  { id: 'cheer', title: '开心', description: '举双钳、蹦两下。' },
  { id: 'rest', title: '打盹', description: '闭眼垂钳，点一下就醒来。' },
];
export function PetPage() {
  const settings = useApp(s => s.settings);
  const pet = { enabled: true, size: 44 as 36 | 44 | 52, activity: 'lively' as 'quiet' | 'lively', speech: true, draggable: true, motion: 'on' as 'on' | 'off' | 'auto', ...settings.chatCrab };
  const save = (patch: Partial<typeof pet>) => useApp.getState().patchSettings({ chatCrab: { ...pet, ...patch } });
  const list = useRef<HTMLDivElement>(null), composer = useRef<HTMLDivElement>(null);
  const [action, setAction] = useState<PetAction>('auto'), [key, setKey] = useState(0);
  const [tab, setTab] = useState<'actions' | 'emotions' | 'settings'>('actions');
  const [emotion, setEmotion] = useState(LEXICON[0]!.id);
  const [intensity, setIntensity] = useState(65);
  const current = ACTIONS.find(a => a.id === action)!;
  const showingEmotion = tab === 'emotions';
  return <div className="pet-page">
    <PageHeader title="桌宠" to="/" backLabel="返回聊天" description="一只住在聊天气泡之间的小螃蟹" />
    <div className="pet-page-body">
      <section className="pet-preview" aria-label="桌宠动作预览">
        <div ref={list} className="pet-preview-messages">
          <div className="k-bubble pet-example">今天想去哪里玩？</div>
          <div className="k-bubble pet-example pet-example-right">就在这里，陪着你。</div>
          <div className="k-bubble pet-example">跳过来，让我摸摸。</div>
        </div>
        <ChatCrab scroller={list} composer={composer} paused={false} busy={false} working={false} replay={0} preview={showingEmotion ? 'emotion' : action} previewKey={key} emotionPreview={showingEmotion ? emotion : undefined} emotionIntensity={intensity} />
      </section>
      <p className="pet-hint">{showingEmotion ? GESTURE_HINTS[emotion] : current.description} 拖动小螃蟹也能预览拖放。</p>
      {settings.motion === 'off' && <p className="pet-hint">App 的全局动效当前已关闭，身体动作会静止。可在外观设置里开启。</p>}
      <div className="pet-tabs" role="tablist" aria-label="桌宠选项">
        <button type="button" role="tab" aria-selected={tab === 'actions'} onClick={() => setTab('actions')}>动作预览</button>
        <button type="button" role="tab" aria-selected={showingEmotion} onClick={() => { setTab('emotions'); setKey(k => k + 1); }}>情绪预览</button>
        <button type="button" role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>陪伴设置</button>
      </div>
      {tab === 'actions' ? <div className="pet-action-grid" role="tabpanel">
        {ACTIONS.map(a => <button type="button" key={a.id} aria-pressed={action === a.id}
          onClick={() => { setAction(a.id); setKey(k => k + 1); }}>
          <span>{a.title}</span><small>{a.description}</small>
        </button>)}
      </div> : showingEmotion ? <section role="tabpanel" aria-label="情绪预览">
        <p className="pet-hint">仅演示，不改变真实情绪记录。</p>
        <label className="pet-intensity">情绪强度 <input aria-label="情绪强度" type="range" min="0" max="100" value={intensity} onChange={e => setIntensity(Number(e.target.value))} /><output>{intensity}</output></label>
        <div className="pet-action-grid">
          {LEXICON.map(g => <button type="button" key={g.id} aria-label={g.title.replace(/^[A-Z]\.\s*/, '')} aria-pressed={emotion === g.id}
            onClick={() => { setEmotion(g.id); setKey(k => k + 1); }}><span>{g.title.replace(/^[A-Z]\.\s*/, '')}</span><small>{GESTURE_HINTS[g.id]}</small></button>)}
        </div>
      </section> : <section className="pet-settings" role="tabpanel">
        <div className="pet-setting-row"><span>在聊天显示</span><KSwitch label="在聊天显示" checked={pet.enabled} onChange={enabled => save({ enabled })} /></div>
        <div className="pet-setting-row"><span>大小</span><PetChoice label="大小" value={String(chatCrabSize(pet.size))} options={[["36","小 · 36 × 27"],["44","中 · 44 × 33"],["52","大 · 52 × 39"]]} onChange={v => save({ size: Number(v) as 36 | 44 | 52 })} /></div>
        <div className="pet-setting-row"><span>活动量</span><PetChoice label="活动量" value={pet.activity} options={[["lively","活泼"],["quiet","安静"]]} onChange={v => save({ activity: v as 'lively' | 'quiet' })} /></div>
        <div className="pet-setting-row"><span>允许拖动</span><KSwitch label="允许拖动" checked={pet.draggable} onChange={draggable => save({ draggable })} /></div>
        <div className="pet-setting-row"><span>短句气泡</span><KSwitch label="短句气泡" checked={pet.speech} onChange={speech => save({ speech })} /></div>
        <div className="pet-setting-row"><span>桌宠动作</span><PetChoice label="桌宠动作" value={pet.motion} options={[["on","开启"],["auto","跟随系统"],["off","关闭"]]} onChange={v => save({ motion: v as 'on' | 'auto' | 'off' })} /></div>
        <p className="pet-hint">称呼使用资料里的名字：{settings.displayName || '你'}。短句在本机生成，不额外请求模型。</p>
        <button type="button" className="k-btn" onClick={() => save({ anchor: undefined })}>重置聊天中的落脚位置</button>
      </section>}
    </div>
  </div>;
}
