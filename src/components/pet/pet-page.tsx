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
  const [tab, setTab] = useState<'actions' | 'settings'>('actions');
  const current = ACTIONS.find(a => a.id === action)!;
  return <div className="pet-page">
    <PageHeader title="桌宠" to="/" backLabel="返回聊天" description="一只住在聊天气泡之间的小螃蟹" />
    <div className="pet-page-body">
      <section className="pet-preview" aria-label="桌宠动作预览">
        <div ref={list} className="pet-preview-messages">
          <div className="k-bubble pet-example">今天想去哪里玩？</div>
          <div className="k-bubble pet-example pet-example-right">就在这里，陪着你。</div>
          <div className="k-bubble pet-example">跳过来，让我摸摸。</div>
          <div className="k-bubble pet-example pet-example-right">也可以把我拖到另一边。</div>
        </div>
        <ChatCrab scroller={list} composer={composer} paused={false} busy={false} working={false} replay={0} preview={action} previewKey={key} />
      </section>
      <p className="pet-hint">{current.description} 拖动小螃蟹也能预览拖放。</p>
      {settings.motion === 'off' && <p className="pet-hint">App 的全局动效当前已关闭，身体动作会静止。可在外观设置里开启。</p>}
      <div className="pet-tabs" role="tablist" aria-label="桌宠选项">
        <button type="button" role="tab" aria-selected={tab === 'actions'} onClick={() => setTab('actions')}>动作预览</button>
        <button type="button" role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>陪伴设置</button>
      </div>
      {tab === 'actions' ? <div className="pet-action-grid" role="tabpanel">
        {ACTIONS.map(a => <button type="button" key={a.id} aria-pressed={action === a.id}
          onClick={() => { setAction(a.id); setKey(k => k + 1); }}>
          <span>{a.title}</span><small>{a.description}</small>
        </button>)}
      </div> : <section className="pet-settings" role="tabpanel">
        <label>在聊天显示<input type="checkbox" checked={pet.enabled} onChange={e => save({ enabled: e.target.checked })} /></label>
        <label>大小<select value={chatCrabSize(pet.size)} onChange={e => save({ size: Number(e.target.value) as 36 | 44 | 52 })}>
          <option value={36}>小 · 36 × 27</option><option value={44}>中 · 44 × 33</option><option value={52}>大 · 52 × 39</option>
        </select></label>
        <label>活动量<select value={pet.activity} onChange={e => save({ activity: e.target.value as 'lively' | 'quiet' })}>
          <option value="lively">活泼</option><option value="quiet">安静</option>
        </select></label>
        <label>允许拖动<input type="checkbox" checked={pet.draggable} onChange={e => save({ draggable: e.target.checked })} /></label>
        <label>短句气泡<input type="checkbox" checked={pet.speech} onChange={e => save({ speech: e.target.checked })} /></label>
        <label>桌宠动作<select value={pet.motion} onChange={e => save({ motion: e.target.value as 'on' | 'off' | 'auto' })}>
          <option value="on">开启</option><option value="auto">跟随系统</option><option value="off">关闭</option>
        </select></label>
        <p className="pet-hint">称呼使用资料里的名字：{settings.displayName || '你'}。短句在本机生成，不额外请求模型。</p>
        <button type="button" className="k-btn" onClick={() => save({ anchor: undefined })}>重置聊天中的落脚位置</button>
      </section>}
    </div>
  </div>;
}
