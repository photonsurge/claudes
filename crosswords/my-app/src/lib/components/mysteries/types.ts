export type MysteryListItem = {
  _id: string;
  kind: string | null;
  title: string;
  logline: string;
  storyPreview: string;
  chapterCount: number;
  characterVisualCount: number;
  locationVisualCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type MysteriesApiResponse = {
  ok: boolean;
  q: string;
  sort?: string;
  page: number;
  limit: number;
  total: number;
  items: MysteryListItem[];
};

export type MysteryDetail = {
  _id: string;
  kind?: string;
  title?: string;
  outline?: Record<string, unknown>;
  outlineJson?: string;
  story?: string;
  chapters?: Array<Record<string, unknown>>;
  characterVisuals?: {
    characters?: Array<{
      character_name?: string;
      options?: Array<{
        option_id?: string;
        label?: string;
        style_tags?: string[];
        image_path?: string;
        image_mime_type?: string;
        svg?: string;
      }>;
    }>;
  };
  locationVisuals?: {
    locations?: Array<{
      location_name?: string;
      location_description?: string;
      options?: Array<{
        option_id?: string;
        label?: string;
        style_tags?: string[];
        image_path?: string;
        image_mime_type?: string;
      }>;
    }>;
  };
  inputs?: Record<string, unknown>;
  models?: Record<string, unknown>;
  source?: Record<string, unknown>;
  createdAt?: string | Date;
  updatedAt?: string | Date;
};
