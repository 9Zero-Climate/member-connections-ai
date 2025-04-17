import { z } from 'zod';

export const NOTION_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;

export const NOTION_BACKGROUND_COLORS = [
  'default_background',
  'gray_background',
  'brown_background',
  'orange_background',
  'yellow_background',
  'green_background',
  'blue_background',
  'purple_background',
  'pink_background',
  'red_background',
] as const;

export const RichTextObject = z.object({
  type: z.literal('text'),
  plain_text: z.string(),
  text: z.object({
    content: z.string(),
    link: z.object({ url: z.string() }).nullable(),
  }),
  annotations: z.object({
    bold: z.boolean(),
    italic: z.boolean(),
    strikethrough: z.boolean(),
    underline: z.boolean(),
    code: z.boolean(),
    color: z.enum(NOTION_COLORS) || z.enum(NOTION_BACKGROUND_COLORS),
  }),
  href: z.string().nullable(),
});

export const TitleProperty = z.object({
  id: z.string(),
  type: z.literal('title'),
  title: z.array(RichTextObject),
});

export const UrlProperty = z.object({
  id: z.string(),
  type: z.literal('url'),
  url: z.string(),
});

export const MultiSelectProperty = z.object({
  id: z.string(),
  type: z.literal('multi_select'),
  multi_select: z.array(
    z.object({
      name: z.string(),
      id: z.string(),
      color: z.enum(NOTION_COLORS),
    }),
  ),
});

export const RichTextProperty = z.object({
  id: z.string(),
  type: z.literal('rich_text'),
  rich_text: z.array(RichTextObject),
});

export const CheckboxProperty = z.object({
  id: z.string(),
  type: z.literal('checkbox'),
  checkbox: z.boolean(),
});
