import type { ReactNode } from 'react';
export function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'field wide' : 'field'}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function FittingDeviceFields({
  value,
  onChange,
}: {
  value: any;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <>
      <Field label="品牌">
        <input
          maxLength={50}
          value={value.brand || ''}
          onChange={(e) => onChange('brand', e.target.value)}
          placeholder="直接填写品牌（选填）"
        />
      </Field>
      <Field label="系列">
        <input
          maxLength={80}
          value={value.series || ''}
          onChange={(e) => onChange('series', e.target.value)}
          placeholder="选填"
        />
      </Field>
      <Field label="助听器型号" wide>
        <input
          maxLength={80}
          value={value.model || ''}
          onChange={(e) => onChange('model', e.target.value)}
          placeholder="直接填写型号；左右耳型号不同时请分别建立验配记录"
        />
      </Field>
      {value.side !== '右耳' && (
        <Field label="左耳助听器序列号（SN）">
          <input
            maxLength={100}
            value={value.serialLeft || ''}
            onChange={(e) => onChange('serialLeft', e.target.value)}
            placeholder="填写机身或包装上的唯一序列号"
          />
        </Field>
      )}
      {value.side !== '左耳' && (
        <Field label="右耳助听器序列号（SN）">
          <input
            maxLength={100}
            value={value.serialRight || ''}
            onChange={(e) => onChange('serialRight', e.target.value)}
            placeholder="填写机身或包装上的唯一序列号"
          />
        </Field>
      )}
      {value.id && value.serial && !value.serialLeft && !value.serialRight && (
        <p className="muted wide">原序列号：{value.serial}。请核对后分别填写左右耳序列号。</p>
      )}
    </>
  );
}
