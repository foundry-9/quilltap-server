/**
 * Ariel Notifications Public API
 *
 * Re-exports the public functions for terminal session announcements.
 */

export {
  postArielSessionOpenedAnnouncement,
  postArielSessionClosedAnnouncement,
  postArielTerminalOutputAnnouncement,
  type ArielSessionOpenedAnnouncement,
  type ArielSessionClosedAnnouncement,
  type ArielTerminalOutputAnnouncement,
} from './writer';
