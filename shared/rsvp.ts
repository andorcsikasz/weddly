// Constants shared by the public RSVP form and the route that accepts it.
// They live here rather than being declared twice because the two copies have
// to agree: the form uses the cap to stop the guest mid-keystroke, the server
// uses it to truncate, and a client that thinks the limit is higher produces
// silently cut messages.

/** Cap on the guest's free-text message to the couple
 *  (`households.guest_message`). Four times the 500 the other free-text RSVP
 *  fields get: those answer a question we asked ("which song?"), while this is
 *  the only box on the form for something we did not think to ask. */
export const GUEST_MESSAGE_MAX = 2000;

/** Cap on the free-text allergy note a guest can add beside the six preset
 *  dietary chips. It is folded into the same `guests.dietary` column the chips
 *  serialise into, which the server caps at 500 in total, so this leaves room
 *  for the chip tokens sharing the string. */
export const DIETARY_FREE_MAX = 240;
