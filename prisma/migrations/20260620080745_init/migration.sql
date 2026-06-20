-- CreateTable
CREATE TABLE "MeetingRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "floor" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "RoomFacility" (
    "roomId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,

    PRIMARY KEY ("roomId", "facilityId"),
    CONSTRAINT "RoomFacility_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "MeetingRoom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RoomFacility_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookerName" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "attendeeCount" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Booking_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "MeetingRoom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRoom_roomNumber_key" ON "MeetingRoom"("roomNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Facility_name_key" ON "Facility"("name");
