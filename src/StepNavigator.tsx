import { useEffect, useState } from 'react';
import type { Catalog } from '../server/content.js';

export function StepNavigator({ steps, doneSteps, currentStep }: { steps: Catalog['steps']; doneSteps: Set<string>; currentStep?: string }) {
  const [active, setActive] = useState(steps[0]?.id);
  const ids = steps.map(s => s.id).join(',');
  useEffect(() => {
    const update = () => {
      if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) {
        setActive(steps.at(-1)?.id || steps[0]?.id); return;
      }
      const visible = steps.filter(s => (document.getElementById(`step-${s.id}`)?.getBoundingClientRect().top ?? Infinity) <= 150);
      setActive(visible.at(-1)?.id || steps[0]?.id);
    };
    update(); window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [ids]);
  function jump(id: string) {
    const card = document.getElementById(`step-${id}`);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    setActive(id);
  }
  return <nav className="card step-navigator" aria-label="Быстрый переход к шагам"><h3>Шаги урока</h3><p>Перейди к нужному шагу</p><div className="step-numbers">{steps.map((step, index) => <button key={step.id} onClick={() => jump(step.id)} title={step.title} aria-label={`Шаг ${index + 1}: ${step.title}${doneSteps.has(step.id) ? ' · выполнен' : ''}`} aria-current={active === step.id ? 'step' : undefined} className={`${active === step.id ? 'active' : ''} ${doneSteps.has(step.id) ? 'done' : ''} ${currentStep === step.id ? 'current' : ''}`}>{index + 1}{doneSteps.has(step.id) && <span aria-hidden="true">✓</span>}</button>)}</div></nav>;
}
