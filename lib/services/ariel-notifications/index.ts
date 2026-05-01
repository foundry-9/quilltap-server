/**
 * Ariel Notifications Public API
 *
 * Re-exports the public functions for terminal session announcements.
 */

export {
  postArielSessionOpenedAnnouncement,
  postArielSessionClosedAnnouncement,
  type ArielSessionOpenedAnnouncement,
  type ArielSessionClosedAnnouncement,
} from './writer';
