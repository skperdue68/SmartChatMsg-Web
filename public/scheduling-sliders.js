const definitions = {
  eventDurationMinutes: { label: 'Event duration', min: 0, max: 240, initial: 0, low: 'Not set', high: '4 hours' },
  recurrenceInterval: { label: 'Recurrence interval', min: 1, max: 10, initial: 1, low: 'Every 1', high: 'Every 10' },
  intervalMinutes: { label: 'Repeat Frequency', min: 1, max: 1440, initial: 60, low: '1 minute', high: '24 hours' },
  maxPerDay: { label: 'Daily announcement limit', min: 0, max: 20, initial: 0, low: 'Unlimited', high: '20 per day' },
};

function duration(minutes) {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}${rest ? ` ${rest} min` : ''}` : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

export function schedulingLabel(key, value, recurrence = 'WEEKLY') {
  if (key === 'maxPerDay') return value ? `${value} per day` : 'Unlimited';
  if (key === 'eventDurationMinutes' && !value) return 'Not set';
  if (key === 'recurrenceInterval') {
    const unit = ({ DAILY: 'day', WEEKLY: 'week', BIWEEKLY: 'two-week period', MONTHLY_DATE: 'month', MONTHLY_WEEKDAY: 'month' })[recurrence] || 'period';
    return `Every ${value} ${unit}${value === 1 ? '' : 's'}`;
  }
  return duration(value);
}

// A loaded value outside the new UI range is retained until the user moves the slider.
export function schedulingValue(input) {
  const value = Number(input.dataset.sliderOriginal ?? input.value);
  if (value === 0 && input.dataset.schedulingSlider === 'eventDurationMinutes') return null;
  if (value === 0 && input.dataset.schedulingSlider === 'maxPerDay') return undefined;
  return value;
}

export function schedulingSlider(key, saved, recurrence = 'WEEKLY') {
  const d = definitions[key], value = Number(saved ?? d.initial), original = Number.isFinite(value) && (value < d.min || value > d.max);
  const initial = Math.max(d.min, Math.min(d.max, Number.isFinite(value) ? value : d.initial));
  const attribute = key === 'maxPerDay' ? 'data-availability' : 'data-field';
  return `<label class="scheduling-slider"><span class="scheduling-slider-heading"><span>${d.label}</span><output aria-live="polite">${schedulingLabel(key, value, recurrence)}</output></span><input type="range" ${attribute}="${key}" data-scheduling-slider="${key}" min="${d.min}" max="${d.max}" step="1" value="${initial}"${original ? ` data-slider-original="${value}"` : ''}><span class="scheduling-slider-ends" aria-hidden="true"><span>${d.low}</span><span>${d.high}</span></span><small class="scheduling-slider-preserved"${original ? '' : ' hidden'}>Saved value kept. Move the slider to replace it.</small></label>`;
}

export function bindSchedulingSliders(root) {
  const sliders = [...root.querySelectorAll('[data-scheduling-slider]')];
  for (const input of sliders) {
    input.addEventListener('input', () => { delete input.dataset.sliderOriginal; refresh(input, root); });
    refresh(input, root);
  }
  root.querySelector('[data-field=recurrence]')?.addEventListener('change', () => sliders.forEach(input=>refresh(input, root)));
}

function refresh(input, root) {
    const key = input.dataset.schedulingSlider, value = schedulingValue(input) ?? 0;
    const text = schedulingLabel(key, value, root.querySelector('[data-field=recurrence]')?.value);
    const label = input.closest('.scheduling-slider');
    label.querySelector('output').textContent = text;
    label.querySelector('.scheduling-slider-preserved').hidden = input.dataset.sliderOriginal === undefined;
    input.setAttribute('aria-valuetext', text + (input.dataset.sliderOriginal !== undefined ? '; saved value kept until slider is moved' : ''));
    input.style.setProperty('--slider-progress', `${(Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
}

export function setSchedulingSliderValue(input, value, root) {
  const n=Number(value??0),min=Number(input.min),max=Number(input.max);
  input.value=String(Math.max(min,Math.min(max,n)));
  if(n<min||n>max)input.dataset.sliderOriginal=String(n);else delete input.dataset.sliderOriginal;
  refresh(input,root);
}

export function sliderKeyboardHelp(input) {
  const count=['maxPerDay','recurrenceInterval'].includes(input.dataset.schedulingSlider);
  const seconds=input.id==='account-revert-slider';
  return count ? 'Keyboard: Arrow keys adjust by 1; Shift+Arrow and Page Up/Down adjust by 5. Home/End jump to the limits.'
    : seconds ? 'Keyboard: Arrow keys adjust by 1 second; Shift+Arrow adjusts by 10 seconds; Page Up/Down adjusts by 30 seconds. Home/End jump to the limits.'
    : 'Keyboard: Arrow keys adjust by 1 minute; Shift+Arrow adjusts by 15 minutes; Page Up/Down adjusts by 1 hour. Home/End jump to the limits.';
}

// Delegate once so dynamically created sliders use the same keyboard behavior.
export function bindSliderKeyboard(root) {
  root.addEventListener('keydown', event => {
    const input=event.target;
    if(!input.matches?.('input[type="range"]')||input.disabled||event.ctrlKey||event.metaKey||event.altKey)return;
    const count=['maxPerDay','recurrenceInterval'].includes(input.dataset.schedulingSlider),seconds=input.id==='account-revert-slider';
    let value=Number(input.value),delta;
    if(event.key==='Home')value=Number(input.min);
    else if(event.key==='End')value=Number(input.max);
    else {
      const direction=({ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1,PageUp:1,PageDown:-1})[event.key];
      if(!direction)return;
      delta=event.key.startsWith('Page')?(count?5:seconds?30:60):event.shiftKey?(count?5:seconds?10:15):Number(input.step||1);
      value+=direction*delta;
    }
    event.preventDefault();
    input.value=String(Math.max(Number(input.min),Math.min(Number(input.max),value)));
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  });
}
