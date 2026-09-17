'use client'

/**
 * The legacy hand-written per-provider parameter panel.
 *
 * `ImageProfileForm` prefers the schema-driven `ProviderOptionsPanel` whenever
 * the provider's plugin implements `getImageProviderOptionsSchema`. This
 * remains the fallback for the plugins that have not adopted the hook yet, and
 * for the case where the schema fetch itself fails — a provider whose editor
 * offers nothing at all would be worse than a slightly stale size list.
 */

interface ImageProfileParametersProps {
  provider: string
  parameters: Record<string, any>
  onChange: (params: Record<string, any>) => void
}

/**
 * Providers whose only optional parameter is a default size share this block —
 * same wrapper, heading, and select; only the option list and caption differ.
 */
function SizeOnlyParameters({
  sizes,
  caption,
  value,
  onSizeChange,
}: {
  sizes: Array<{ value: string; label: string }>
  caption: string
  value: string
  onSizeChange: (size: string) => void
}) {
  return (
    <div className="space-y-4 border-t qt-border-default pt-4">
      <h3 className="text-sm qt-text-primary">Image Parameters (Optional)</h3>

      {/* Size */}
      <div>
        <label className="qt-label mb-1">
          Default Size
        </label>
        <select
          value={value}
          onChange={e => onSizeChange(e.target.value)}
          className="qt-select"
        >
          {sizes.map(size => (
            <option key={size.value} value={size.value}>{size.label}</option>
          ))}
        </select>
        <p className="qt-text-xs mt-1">{caption}</p>
      </div>
    </div>
  )
}

const Z_AI_SIZES = [
  { value: '1024x1024', label: 'Square (1024x1024)' },
  { value: '1280x1280', label: 'Square (1280x1280)' },
  { value: '1568x1056', label: 'Landscape (1568x1056)' },
  { value: '1664x928', label: 'Wide (1664x928)' },
  { value: '1472x1104', label: 'Landscape (1472x1104)' },
  { value: '1056x1568', label: 'Portrait (1056x1568)' },
  { value: '928x1664', label: 'Tall (928x1664)' },
  { value: '1104x1472', label: 'Portrait (1104x1472)' },
]

const NANOGPT_SIZES = [
  { value: '1024x1024', label: 'Square (1024x1024)' },
  { value: '1248x832', label: 'Landscape (1248x832)' },
  { value: '1360x768', label: 'Wide (1360x768)' },
  { value: '1536x1024', label: 'Landscape (1536x1024)' },
  { value: '832x1248', label: 'Portrait (832x1248)' },
  { value: '768x1360', label: 'Tall (768x1360)' },
  { value: '1024x1536', label: 'Portrait (1024x1536)' },
]

export function ImageProfileParameters({
  provider,
  parameters,
  onChange,
}: ImageProfileParametersProps) {
  const handleChange = (key: string, value: any) => {
    onChange({
      ...parameters,
      [key]: value,
    })
  }

  const handleRemove = (key: string) => {
    const newParams = { ...parameters }
    delete newParams[key]
    onChange(newParams)
  }

  switch (provider) {
    case 'OPENAI':
      // The OpenAI plugin implements getImageProviderOptionsSchema, so this
      // branch renders only when that fetch fails — which means we cannot know
      // the selected model. The lists below are therefore the union across
      // families; the provider drops any tier or size the chosen model rejects
      // rather than sending it into a 400.
      return (
        <div className="space-y-4 border-t qt-border-default pt-4">
          <h3 className="text-sm qt-text-primary">Image Parameters (Optional)</h3>

          {/* Quality */}
          <div>
            <label className="qt-label mb-1">
              Quality
            </label>
            <select
              value={parameters.quality || ''}
              onChange={e => handleChange('quality', e.target.value)}
              className="qt-select"
            >
              <option value="">(model default)</option>
              <option value="auto">Auto (the model chooses)</option>
              <option value="low">Low (GPT Image)</option>
              <option value="medium">Medium (GPT Image)</option>
              <option value="high">High (GPT Image)</option>
              <option value="xhigh">Extra High (GPT Image 2.5)</option>
              <option value="max">Max (GPT Image 2.5)</option>
              <option value="standard">Standard (DALL-E)</option>
              <option value="hd">HD (DALL-E 3)</option>
            </select>
            <p className="qt-text-xs mt-1">Higher tiers cost more and take longer</p>
          </div>

          {/* Style */}
          <div>
            <label className="qt-label mb-1">
              Style
            </label>
            <select
              value={parameters.style || ''}
              onChange={e => handleChange('style', e.target.value)}
              className="qt-select"
            >
              <option value="">(model default)</option>
              <option value="vivid">Vivid (Dramatic, hyper-real)</option>
              <option value="natural">Natural (Realistic, less exaggerated)</option>
            </select>
            <p className="qt-text-xs mt-1">DALL-E 3 only; the GPT Image models ignore it</p>
          </div>

          {/* Size */}
          <div>
            <label className="qt-label mb-1">
              Default Size
            </label>
            <select
              value={parameters.size || ''}
              onChange={e => handleChange('size', e.target.value)}
              className="qt-select"
            >
              <option value="">(model default)</option>
              <option value="auto">Auto (the model chooses)</option>
              <option value="1024x1024">Square (1024x1024)</option>
              <option value="1536x1024">Landscape (1536x1024)</option>
              <option value="1024x1536">Portrait (1024x1536)</option>
              <option value="1792x1024">Landscape (1792x1024)</option>
              <option value="1024x1792">Portrait (1024x1792)</option>
              <option value="2560x1440">Landscape (2560x1440)</option>
              <option value="1440x2560">Portrait (1440x2560)</option>
              <option value="3840x2160">Landscape (3840x2160)</option>
              <option value="2160x3840">Portrait (2160x3840)</option>
            </select>
            <p className="qt-text-xs mt-1">
              Default image dimensions. Sizes above 1536x1024 need GPT Image 2 or 2.5.
            </p>
          </div>
        </div>
      )

    case 'GOOGLE':
    case 'GOOGLE_IMAGEN':
      return (
        <div className="space-y-4 border-t qt-border-default pt-4">
          <h3 className="text-sm qt-text-primary">Image Parameters (Optional)</h3>

          {/* Aspect Ratio */}
          <div>
            <label className="qt-label mb-1">
              Default Aspect Ratio
            </label>
            <select
              value={parameters.aspectRatio || '1:1'}
              onChange={e => handleChange('aspectRatio', e.target.value)}
              className="qt-select"
            >
              <option value="1:1">Square (1:1)</option>
              <option value="16:9">Landscape (16:9)</option>
              <option value="9:16">Portrait (9:16)</option>
              <option value="4:3">Standard (4:3)</option>
              <option value="3:2">Photo (3:2)</option>
            </select>
            <p className="qt-text-xs mt-1">Default aspect ratio for image generation</p>
          </div>

          {/* Negative Prompt */}
          <div>
            <label className="qt-label mb-1">
              Default Negative Prompt
            </label>
            <textarea
              value={parameters.negativePrompt || ''}
              onChange={e => handleChange('negativePrompt', e.target.value)}
              placeholder="e.g., blurry, low quality, distorted"
              className="qt-textarea"
              rows={2}
            />
            <p className="qt-text-xs mt-1">Things to avoid in generated images</p>
          </div>
        </div>
      )

    case 'Z_AI':
      return (
        <SizeOnlyParameters
          sizes={Z_AI_SIZES}
          caption="Z.AI's recommended sizes for CogView and GLM-Image"
          value={parameters.size || '1024x1024'}
          onSizeChange={size => handleChange('size', size)}
        />
      )

    case 'NANOGPT':
      return (
        <SizeOnlyParameters
          sizes={NANOGPT_SIZES}
          caption="Common sizes across NanoGPT's image models; each model maps to its nearest native resolution"
          value={parameters.size || '1024x1024'}
          onSizeChange={size => handleChange('size', size)}
        />
      )

    case 'GROK':
      return (
        <div className="border-t qt-border-default pt-4">
          <p className="qt-text-small">
            Grok supports basic text-to-image generation with minimal parameters.
            Configuration is handled through the main prompt.
          </p>
        </div>
      )

    default:
      return null
  }
}
