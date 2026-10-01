/** OpenAPI-Fixtures im Stil der fal-Dokumente (Pydantic-generiert, mit $refs, anyOf, allOf, enums). */

const queuePaths = (app: string) => ({
  [`/${app}/requests/{request_id}/status`]: {
    get: {
      parameters: [{ name: 'request_id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/QueueStatus' } } } } },
    },
  },
  [`/${app}/requests/{request_id}/cancel`]: {
    put: { responses: { '200': { description: 'ok' } } },
  },
});

const queueStatusSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'] },
    request_id: { type: 'string' },
  },
  required: ['status', 'request_id'],
};

/** h3-max text-to-video (Felder laut fal-Seiten/pollinations; Struktur wie fal). */
export const h3MaxOpenApi = {
  openapi: '3.0.4',
  info: { title: 'Queue OpenAPI for minimax/h3-max/text-to-video', version: '1.0.0', 'x-fal-metadata': { endpointId: 'minimax/h3-max/text-to-video', category: 'text-to-video' } },
  components: {
    securitySchemes: { apiKeyAuth: { type: 'apiKey', in: 'header', name: 'Authorization' } },
    schemas: {
      QueueStatus: queueStatusSchema,
      AspectRatio: { title: 'AspectRatio', type: 'string', enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
      Resolution: { title: 'Resolution', type: 'string', enum: ['480P', '768P', '1080P'] },
      H3MaxTextToVideoInput: {
        title: 'TextToVideoInput',
        type: 'object',
        'x-fal-order-properties': ['prompt', 'duration', 'resolution', 'aspect_ratio', 'seed', 'reference_audio_urls', 'reference_image_urls'],
        properties: {
          prompt: { title: 'Prompt', type: 'string', maxLength: 4000, description: 'The text prompt describing the video, including dialogue, sound and camera.' },
          duration: { title: 'Duration', type: 'integer', enum: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], default: 5, description: 'Duration in seconds.' },
          resolution: { allOf: [{ $ref: '#/components/schemas/Resolution' }], default: '768P', description: 'Output resolution.' },
          aspect_ratio: { anyOf: [{ $ref: '#/components/schemas/AspectRatio' }, { type: 'null' }], default: '16:9', title: 'Aspect Ratio' },
          seed: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Seed' },
          reference_audio_urls: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'Audio references.' },
          reference_image_urls: { type: 'array', items: { type: 'string' }, description: 'Image references.' },
          enable_safety_checker: { type: 'boolean', default: true },
        },
        required: ['prompt'],
      },
      H3MaxTextToVideoOutput: { type: 'object', properties: { video: { $ref: '#/components/schemas/File' } } },
      File: { type: 'object', properties: { url: { type: 'string' }, content_type: { type: 'string' } }, required: ['url'] },
    },
  },
  paths: {
    ...queuePaths('minimax/h3-max'),
    '/minimax/h3-max/text-to-video': {
      post: {
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/H3MaxTextToVideoInput' } } } },
        responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/QueueStatus' } } } } },
      },
    },
    '/minimax/h3-max/text-to-video/requests/{request_id}': {
      get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/H3MaxTextToVideoOutput' } } } } } },
    },
  },
  servers: [{ url: 'https://queue.fal.run' }],
};

/** FLUX-artig: image_size als anyOf aus Objekt-$ref und Preset-Enum. */
export const fluxOpenApi = {
  openapi: '3.0.4',
  info: { title: 'flux', version: '1' },
  components: {
    schemas: {
      QueueStatus: queueStatusSchema,
      ImageSize: {
        title: 'ImageSize',
        type: 'object',
        properties: {
          width: { type: 'integer', minimum: 1, maximum: 14142, default: 512, title: 'Width' },
          height: { type: 'integer', minimum: 1, maximum: 14142, default: 512, title: 'Height' },
        },
      },
      FluxDevInput: {
        type: 'object',
        properties: {
          prompt: { type: 'string', title: 'Prompt', description: 'The prompt to generate an image from.' },
          image_size: {
            anyOf: [{ $ref: '#/components/schemas/ImageSize' }, { type: 'string', enum: ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9'] }],
            default: 'landscape_4_3',
            description: 'The size of the generated image.',
          },
          num_images: { type: 'integer', minimum: 1, maximum: 4, default: 1, title: 'Num Images' },
          num_inference_steps: { type: 'integer', minimum: 1, maximum: 50, default: 28 },
          guidance_scale: { type: 'number', minimum: 1, maximum: 20, default: 3.5 },
          seed: { type: 'integer' },
          enable_safety_checker: { type: 'boolean', default: true },
          output_format: { type: 'string', enum: ['jpeg', 'png'], default: 'jpeg' },
        },
        required: ['prompt'],
      },
    },
  },
  paths: {
    ...queuePaths('fal-ai/flux'),
    '/fal-ai/flux/dev': {
      post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/FluxDevInput' } } } } },
    },
  },
};

/** Segmentierung mit verschachtelten Array-$refs und rekursivem Typ. */
export const samOpenApi = {
  openapi: '3.0.4',
  components: {
    schemas: {
      PointPrompt: {
        type: 'object',
        properties: { x: { type: 'integer' }, y: { type: 'integer' }, label: { type: 'integer', enum: [0, 1] } },
        required: ['x', 'y'],
      },
      BoxPrompt: { type: 'object', properties: { x_min: { type: 'integer' }, y_min: { type: 'integer' }, x_max: { type: 'integer' }, y_max: { type: 'integer' } } },
      Node: { type: 'object', properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } } },
      SamInput: {
        type: 'object',
        properties: {
          image_url: { type: 'string', description: 'URL of the image to be segmented' },
          point_prompts: { type: 'array', items: { $ref: '#/components/schemas/PointPrompt' } },
          box_prompts: { type: 'array', items: { $ref: '#/components/schemas/BoxPrompt' } },
          prompt: { type: 'string', default: 'wheel' },
          tree: { $ref: '#/components/schemas/Node' },
          mask_only: { allOf: [{ type: 'boolean' }, { description: 'Nur Maske' }], default: false },
        },
        required: ['image_url'],
      },
    },
  },
  paths: {
    '/fal-ai/sam-3/image': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/SamInput' } } } } } },
  },
};

/** Whisper-artig (chunk_level mit word, audio_url). */
export const whisperSchema = {
  type: 'object',
  properties: {
    audio_url: { type: 'string', description: 'URL of the audio file to transcribe.' },
    chunk_level: { type: 'string', enum: ['none', 'segment', 'word'], default: 'segment' },
    language: { anyOf: [{ type: 'string', enum: ['de', 'en'] }, { type: 'null' }] },
    diarize: { type: 'boolean', default: false },
  },
  required: ['audio_url'],
};

/** Veo-artig: Dauer als String-Enum, generate_audio. */
export const veoSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    aspect_ratio: { type: 'string', enum: ['16:9', '9:16'], default: '16:9' },
    duration: { type: 'string', enum: ['4s', '6s', '8s'], default: '8s' },
    resolution: { type: 'string', enum: ['720p', '1080p'], default: '720p' },
    generate_audio: { type: 'boolean', default: true },
    seed: { type: 'integer' },
  },
  required: ['prompt'],
};

/** Lipsync (video_url + audio_url). */
export const lipsyncSchema = {
  type: 'object',
  properties: {
    video_url: { type: 'string', description: 'URL of the input video' },
    audio_url: { type: 'string', description: 'URL of the input audio' },
    sync_mode: { type: 'string', enum: ['cut_off', 'loop', 'bounce', 'silence', 'remap'], default: 'cut_off' },
  },
  required: ['video_url', 'audio_url'],
};

/** Bildbearbeitung mit mehreren Referenzbildern. */
export const editSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    image_urls: { type: 'array', items: { type: 'string' } },
    num_images: { type: 'integer', minimum: 1, maximum: 4, default: 1 },
    aspect_ratio: { type: 'string', enum: ['auto', '16:9', '1:1', '4:5', '9:16'], default: 'auto' },
    resolution: { type: 'string', enum: ['1K', '2K', '4K'], default: '1K' },
    output_format: { type: 'string', enum: ['jpeg', 'png', 'webp'] },
  },
  required: ['prompt', 'image_urls'],
};

/** Sound-Effekte (duration_seconds 0,5–22) und Musik in Millisekunden. */
export const sfxSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    duration_seconds: { anyOf: [{ type: 'number', minimum: 0.5, maximum: 22 }, { type: 'null' }] },
    loop: { type: 'boolean' },
    output_format: { type: 'string', enum: ['mp3_44100_128', 'pcm_16000'] },
  },
  required: ['text'],
};

export const musicSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    music_length_ms: { type: 'integer', minimum: 3000, maximum: 600000 },
    force_instrumental: { type: 'boolean' },
  },
};

/** Eintrag der Modellsuche im fal-Format. */
export function modelEntry(endpointId: string, category: string, extra: Record<string, unknown> = {}, openapi?: unknown): Record<string, unknown> {
  return {
    endpoint_id: endpointId,
    metadata: {
      display_name: `Live ${endpointId}`,
      category,
      description: `Live description of ${endpointId}`,
      status: 'active',
      tags: ['live'],
      updated_at: '2026-09-30T00:00:00Z',
      thumbnail_url: `https://fal.media/thumbs/${endpointId.replace(/\//g, '_')}.png`,
      ...extra,
    },
    ...(openapi ? { openapi } : {}),
  };
}
