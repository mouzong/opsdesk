import type { Environment } from '../../shared/constants';

/** Payload accepted by the bookmark create / update API. */
export interface BookmarkData {
  title: string;
  url: string;
  description: string;
  environment: Environment;
  owner: string;
  icon: string | null;
  tags: string[];
  favorite: boolean;
  note: string;
}
