import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import AppButton from '@/components/app-button';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import Modal from './modal';
import {
  applyChange,
  errorMessage,
  slug,
  type Collection,
  type Field,
  type FieldType,
  type Template,
  type Workspace,
} from '@/lib/crm';
const labels: Record<FieldType, string> = {
  text: 'Text',
  longtext: 'Long text',
  number: 'Number',
  email: 'Email',
  url: 'URL',
  date: 'Date',
  checkbox: 'Checkbox',
  select: 'Select',
  multiselect: 'Multi-select',
  relation: 'Relation',
};
export default function SchemaEditor({
  workspace,
  collection,
  template,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  collection?: Collection;
  template?: Template;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const initial = collection || template;
  const [name, setName] = useState(initial?.name || '');
  const [id, setId] = useState(initial?.id || '');
  const [customKey, setCustomKey] = useState(false);
  const [description, setDescription] = useState(initial?.description || '');
  const [color, setColor] = useState(initial?.color || '#718278');
  const [fields, setFields] = useState<Field[]>(
    initial?.fields.map((f) => ({ ...f })) || [],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const patchField = (index: number, patch: Partial<Field>) => {
    setDirty(true);
    setFields((current) =>
      current.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
  };
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await applyChange(`${collection ? 'Update' : 'Create'} ${name}`, [
        {
          type: collection ? 'update_collection' : 'create_collection',
          id,
          ...(collection ? { version: collection.version } : {}),
          name,
          description,
          color,
          fields: fields.map((f) => ({
            key: f.key,
            name: f.name,
            type: f.type,
            required: f.required || false,
            unique: f.unique || false,
            ...(['select', 'multiselect'].includes(f.type)
              ? { options: f.options || [] }
              : {}),
            ...(f.type === 'relation' ? { collection: f.collection } : {}),
          })),
        },
      ]);
      await onSaved(id);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={collection ? 'Edit collection fields' : 'New collection'}
      subtitle="Choose a structure. Your agents use the same schema."
      onClose={onClose}
      dirty={dirty}
    >
      <form onSubmit={save}>
        <div className="crm-form-body">
          <div className="crm-form-grid">
            <Label>
              Collection name
              <Input
                required
                maxLength={80}
                value={name}
                placeholder="e.g. Partnerships"
                onChange={(e) => {
                  setName(e.target.value);
                  if (!collection && !customKey) setId(slug(e.target.value));
                  setDirty(true);
                }}
              />
            </Label>
            <Label>
              Collection key
              <Input
                required
                pattern="[a-z][a-z0-9_]{0,63}"
                value={id}
                disabled={Boolean(collection)}
                onChange={(e) => {
                  setCustomKey(true);
                  setId(e.target.value);
                  setDirty(true);
                }}
              />
              <small>Stable key used by your agents.</small>
            </Label>
          </div>
          <Label>
            Description
            <Textarea
              rows={2}
              value={description}
              maxLength={2000}
              placeholder="What belongs here?"
              onChange={(e) => {
                setDescription(e.target.value);
                setDirty(true);
              }}
            />
          </Label>
          <Label className="crm-color-label">
            Collection color
            <Input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setDirty(true);
              }}
            />
          </Label>
          <div className="crm-section-label">
            <h3>Fields</h3>
            <span>Every record already has a title.</span>
          </div>
          <div className="crm-schema-fields">
            {fields.map((field, index) => (
              <div className="crm-schema-field" key={index}>
                <div className="crm-field-row">
                  <Label>
                    Field name
                    <Input
                      aria-label={`Field ${index + 1} name`}
                      value={field.name}
                      required
                      onChange={(e) =>
                        patchField(index, {
                          name: e.target.value,
                          ...(!collection &&
                          (!field.key || field.key === slug(field.name))
                            ? { key: slug(e.target.value) }
                            : {}),
                        })
                      }
                    />
                  </Label>
                  <Label>
                    Key
                    <Input
                      aria-label={`Field ${index + 1} key`}
                      value={field.key}
                      required
                      disabled={Boolean(
                        collection?.fields.some((f) => f.key === field.key),
                      )}
                      onChange={(e) =>
                        patchField(index, { key: e.target.value })
                      }
                    />
                  </Label>
                  <Label>
                    Type
                    <NativeSelect
                      aria-label={`Field ${index + 1} type`}
                      value={field.type}
                      onChange={(e) =>
                        patchField(index, {
                          type: e.target.value as FieldType,
                          unique: false,
                        })
                      }
                    >
                      {Object.entries(labels).map(([value, label]) => (
                        <NativeSelectOption key={value} value={value}>
                          {label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Label>
                  <AppButton
                    type="button"
                    aria-label={`Remove field ${index + 1}`}
                    className="crm-icon-button"
                    onClick={() => {
                      setFields((current) =>
                        current.filter((_, i) => i !== index),
                      );
                      setDirty(true);
                    }}
                  >
                    <Trash2 size={16} />
                  </AppButton>
                </div>
                {['select', 'multiselect'].includes(field.type) && (
                  <Label>
                    Options, separated by commas
                    <Input
                      aria-label={`Field ${index + 1} options`}
                      value={(field.options || []).join(',')}
                      placeholder="New, In progress, Done"
                      onChange={(e) =>
                        patchField(index, {
                          options: e.target.value.split(','),
                        })
                      }
                    />
                  </Label>
                )}
                {field.type === 'relation' && (
                  <Label>
                    Related collection
                    <NativeSelect
                      required
                      value={field.collection || ''}
                      onChange={(e) =>
                        patchField(index, { collection: e.target.value })
                      }
                    >
                      <NativeSelectOption value="">Choose collection</NativeSelectOption>
                      {workspace.collections.map((c) => (
                        <NativeSelectOption key={c.id} value={c.id}>
                          {c.name}
                        </NativeSelectOption>
                      ))}
                      {!collection && id && (
                        <NativeSelectOption value={id}>{name || 'This collection'}</NativeSelectOption>
                      )}
                    </NativeSelect>
                  </Label>
                )}
                <div className="crm-field-flags">
                  <Label>
                    <Checkbox
                      checked={field.required || false}
                      onCheckedChange={(e) =>
                        patchField(index, { required: e })
                      }
                    />
                    Required
                  </Label>
                  {['text', 'email', 'url', 'number'].includes(field.type) && (
                    <Label>
                      <Checkbox
                        checked={field.unique || false}
                        onCheckedChange={(e) =>
                          patchField(index, { unique: e })
                        }
                      />
                      Unique
                    </Label>
                  )}
                </div>
              </div>
            ))}
          </div>
          <AppButton
            type="button"
            className="crm-button crm-button-subtle"
            disabled={fields.length >= 40}
            onClick={() => {
              setFields((current) => [
                ...current,
                { key: '', name: '', type: 'text' },
              ]);
              setDirty(true);
            }}
          >
            <Plus size={15} />
            Add field
          </AppButton>
          {collection && (
            <p className="crm-hint">
              Changes are checked against every record and saved view. Existing
              values cannot be silently removed.
            </p>
          )}
          {error && (
            <p className="crm-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <AppButton
            type="button"
            className="crm-button"
            disabled={busy}
            onClick={() => {
              if (!dirty || window.confirm('Discard your unsaved changes?'))
                onClose();
            }}
          >
            Cancel
          </AppButton>
          <AppButton className="crm-button crm-button-primary" disabled={busy}>
            {busy
              ? 'Saving…'
              : collection
                ? 'Save schema'
                : 'Create collection'}
          </AppButton>
        </footer>
      </form>
    </Modal>
  );
}
