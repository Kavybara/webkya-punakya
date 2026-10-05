const fields = (row, keys) => Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));

export function bootstrapMetadata(rentals = [], groups = []) {
  return {
    whatsappRentals: rentals.map((row) => fields(row, ["id", "groupJid", "name", "status", "daysLeft", "startedAt", "endsAt", "listCount", "updatedAt"])),
    whatsappGroupLists: groups.map((row) => ({ ...fields(row, ["groupJid", "name", "total", "updatedAt"]),
      entries: (row.entries || []).map((entry) => fields(entry, ["keyword", "updatedAt", "updated_at"])) })),
  };
}
