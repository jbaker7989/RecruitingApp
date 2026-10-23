import { initializeStore, readStore, updateStore, closeStore } from '../../src/models/store.js';

async function main(): Promise<void> {
  const command = process.argv[2];
  await initializeStore();

  if (command === 'write-marker') {
    await updateStore((store) => {
      if (!store.companies.some((company) => company.id === 'cross-process-company')) {
        const timestamp = new Date().toISOString();
        store.companies.push({
          id: 'cross-process-company',
          companyName: 'Cross Process Company',
          description: 'Synthetic durability marker',
          location: 'Test',
          companySize: '1',
          industry: 'Testing',
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    });
  }

  const store = await readStore();
  process.stdout.write(`DB_PROBE:${JSON.stringify({
    mode: 'postgres',
    companyIds: store.companies.map((company) => company.id),
    applicantIds: store.applicants.map((applicant) => applicant.id),
    applicationIds: store.applications.map((application) => application.id),
  })}\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeStore().catch(() => {});
  });
