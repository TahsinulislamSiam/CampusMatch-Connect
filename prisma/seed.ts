import { PrismaClient } from "@prisma/client";
import { UNIVERSITIES, CAMPUSES } from "../src/lib/mock-data";

/**
 * Reference data seed.
 *
 * The registration flow validates `universityId` against a curated list and the
 * database holds a foreign key to `University`, so those rows must exist before
 * the first signup. Seed only reference tables here — never users, never PII.
 *
 * Idempotent: upserts by primary key, so it is safe to run repeatedly
 * (`npm run db:seed`) and in CI before tests.
 */
const prisma = new PrismaClient();

async function main() {
  let universities = 0;
  for (const u of UNIVERSITIES) {
    await prisma.university.upsert({
      where: { id: u.id },
      update: { nameEn: u.nameEn, nameBn: u.nameBn, city: u.city, type: u.type, emailDomains: u.emailDomains.join(",") },
      create: {
        id: u.id,
        slug: u.slug,
        nameEn: u.nameEn,
        nameBn: u.nameBn,
        city: u.city,
        type: u.type,
        emailDomains: u.emailDomains.join(","),
        isActive: true,
      },
    });
    universities++;
  }

  let campuses = 0;
  for (const c of CAMPUSES) {
    await prisma.campus.upsert({
      where: { id: c.id },
      update: { nameEn: c.nameEn, nameBn: c.nameBn, area: c.area },
      create: { id: c.id, universityId: c.universityId, nameEn: c.nameEn, nameBn: c.nameBn, area: c.area },
    });
    campuses++;
  }

  console.log(`seed: ${universities} universities, ${campuses} campuses`);
}

main()
  .catch((error) => {
    console.error("seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
