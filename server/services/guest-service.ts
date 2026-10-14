/**
 * 访客资料业务。
 */
import type { GuestRecord } from "../stores/memory";
import type { AvatarIcon } from "#shared/constants/avatar";
import { useMemory } from "../stores/memory";
import { broadcastProfileUpdate } from "./room-service";
import { ValidationError } from "../utils/validate";

export function updateProfile(
  guest: GuestRecord,
  nickname: string,
  avatarIcon: AvatarIcon,
): GuestRecord {
  guest.nickname = nickname;
  guest.avatarIcon = avatarIcon;
  useMemory().guests.set(guest.id, guest);
  broadcastProfileUpdate(guest);
  return guest;
}

export function assertGuestCapacity(): void {
  const state = useMemory();
  if (state.guests.size >= state.limits.maxGuests) {
    throw new ValidationError(
      "GUEST_CAPACITY_EXCEEDED",
      "访客人数已达上限，请联系服务启动者",
    );
  }
}
