-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MeetingRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "floor" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "splitStatus" TEXT NOT NULL DEFAULT 'normal',
    "parentRoomId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingRoom_parentRoomId_fkey" FOREIGN KEY ("parentRoomId") REFERENCES "MeetingRoom" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MeetingRoom" ("capacity", "createdAt", "floor", "id", "isActive", "name", "roomNumber", "updatedAt") SELECT "capacity", "createdAt", "floor", "id", "isActive", "name", "roomNumber", "updatedAt" FROM "MeetingRoom";
DROP TABLE "MeetingRoom";
ALTER TABLE "new_MeetingRoom" RENAME TO "MeetingRoom";
CREATE UNIQUE INDEX "MeetingRoom_roomNumber_key" ON "MeetingRoom"("roomNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
