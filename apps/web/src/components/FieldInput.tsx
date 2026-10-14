import { optionsOf, type FieldDef, type FieldValue } from '@acad/engine';
import { company } from '../lib/config';

interface Props {
  def: FieldDef;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
  missing?: boolean;
  error?: string;
}

export function FieldInput({ def, value, onChange, missing, error }: Props) {
  const id = `f-${def.key}`;
  const dir = def.dir ?? 'ltr';
  const cls = `input${missing ? ' missing' : ''}`;
  const str = typeof value === 'string' ? value : '';
  const options = optionsOf(def, company);
  const describedBy = [def.help ? `${id}-help` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;

  let control;
  switch (def.type) {
    case 'textarea':
      control = <textarea id={id} className={cls} dir={dir} value={str} maxLength={def.maxLength} placeholder={def.placeholder} aria-invalid={!!error} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'date':
      control = <input id={id} className={cls} type="date" value={str} aria-invalid={!!error} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'select':
      control = (
        <select id={id} className={cls} value={str} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Select —</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.en} / {o.ar}
            </option>
          ))}
        </select>
      );
      break;
    case 'yesno':
      control = (
        <div className="chips" role="radiogroup" aria-labelledby={`${id}-label`}>
          {[
            ['yes', 'Yes / نعم'],
            ['no', 'No / لا'],
            ['', 'Not answered'],
          ].map(([v, label]) => (
            <label key={v} className={`chip ${str === v ? 'on' : ''}`}>
              <input type="radio" name={id} checked={str === v} onChange={() => onChange(v)} />
              {label}
            </label>
          ))}
        </div>
      );
      break;
    case 'multiselect': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div className="chips" role="group" aria-labelledby={`${id}-label`}>
          {options.map((o) => {
            const on = arr.includes(o.value);
            return (
              <label key={o.value} className={`chip ${on ? 'on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])} />
                {o.en} <span dir="rtl">/ {o.ar}</span>
              </label>
            );
          })}
        </div>
      );
      break;
    }
    default:
      control = (
        <input id={id} className={cls} dir={dir} value={str} maxLength={def.maxLength} placeholder={def.placeholder} aria-invalid={!!error} aria-describedby={describedBy} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
      );
  }

  return (
    <div className={`field${def.type === 'textarea' || def.type === 'multiselect' || def.type === 'yesno' ? ' span-2' : ''}`}>
      <label htmlFor={id} id={`${id}-label`}>
        <span>
          {def.label}
          {missing && <span className="badge badge-warn" style={{ marginLeft: 6 }}>empty</span>}
        </span>
        {def.labelAr && <span className="label-ar">{def.labelAr}</span>}
      </label>
      {control}
      {def.help && (
        <span className="help" id={`${id}-help`}>
          {def.help}
        </span>
      )}
      {error && (
        <span className="error" id={`${id}-err`}>
          {error}
        </span>
      )}
    </div>
  );
}
