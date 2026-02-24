CREATE TABLE "checkpoints" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "topicName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB,
    "unlockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "checkpoints_userId_subject_topicId_key" ON "checkpoints"("userId", "subject", "topicId");
