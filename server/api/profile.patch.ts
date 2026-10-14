/**
 * PATCH /api/profile — 修改当前资料并广播到所在房间。
 */
import { toGuestPublic } from "../utils/dto";
import {
  assertWriteOrigin,
  mapValidationError,
  noStore,
  readCappedJson,
  requireWriteGuest,
} from "../utils/http";
import { updateProfile } from "../services/guest-service";
import { validateAvatarIcon, validateNickname } from "../utils/validate";

export default defineEventHandler(async (event) => {
  noStore(event);
  try {
    assertWriteOrigin(event);
    const guest = requireWriteGuest(event);
    const body = await readCappedJson(event);
    const nickname = validateNickname(body.nickname);
    const avatarIcon = validateAvatarIcon(body.avatarIcon);
    const updated = updateProfile(guest, nickname, avatarIcon);
    return { guest: toGuestPublic(updated) };
  } catch (error) {
    mapValidationError(error);
  }
});
