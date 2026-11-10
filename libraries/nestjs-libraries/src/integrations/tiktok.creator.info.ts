export const TIKTOK_CREATOR_INFO_PROTOCOL = 'tiktok-creator-info-v1';

export const TIKTOK_PRIVACY_LEVELS = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
] as const;

export type TikTokPrivacyLevel = (typeof TIKTOK_PRIVACY_LEVELS)[number];

export interface TikTokCreatorInfo {
  nickname: string;
  avatar_url: string | null;
  privacy_level_options: TikTokPrivacyLevel[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

/** Project TikTok's response to the minimum data a posting client needs. */
export function projectTikTokCreatorInfo(value: unknown): TikTokCreatorInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TikTok creator information is unavailable');
  }
  const response = value as Record<string, unknown>;
  const error = response.error;
  if (
    error &&
    (typeof error !== 'object' || Array.isArray(error) ||
      !['ok', ''].includes(String((error as Record<string, unknown>).code ?? '')))
  ) {
    throw new Error('TikTok creator information is unavailable');
  }
  const data = response.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('TikTok creator information is unavailable');
  }
  const creator = data as Record<string, unknown>;
  const nickname = creator.creator_nickname;
  const avatar = creator.creator_avatar_url;
  const privacy = creator.privacy_level_options;
  const duration = creator.max_video_post_duration_sec;
  if (
    typeof nickname !== 'string' || !nickname.trim() || nickname.length > 200 ||
    (avatar !== undefined && avatar !== null && (typeof avatar !== 'string' || avatar.length > 2048)) ||
    !Array.isArray(privacy) || !privacy.length ||
    !privacy.every((item): item is TikTokPrivacyLevel => TIKTOK_PRIVACY_LEVELS.includes(item as TikTokPrivacyLevel)) ||
    new Set(privacy).size !== privacy.length ||
    typeof creator.comment_disabled !== 'boolean' ||
    typeof creator.duet_disabled !== 'boolean' ||
    typeof creator.stitch_disabled !== 'boolean' ||
    !Number.isSafeInteger(duration) || (duration as number) < 1 || (duration as number) > 3600
  ) {
    throw new Error('TikTok creator information is unavailable');
  }
  return {
    nickname: nickname.trim(),
    avatar_url: typeof avatar === 'string' && /^https:\/\//.test(avatar) ? avatar : null,
    privacy_level_options: privacy,
    comment_disabled: creator.comment_disabled,
    duet_disabled: creator.duet_disabled,
    stitch_disabled: creator.stitch_disabled,
    max_video_post_duration_sec: duration as number,
  };
}
