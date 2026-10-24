import ProfileViewPage from '@/features/profile/components/profile-view-page';
import { requireActiveEmployeeForPage } from '@/lib/permissions/current-employee';

export const metadata = {
  title: 'Account & Security'
};

export default async function Page() {
  const employee = await requireActiveEmployeeForPage();
  return <ProfileViewPage preferredName={employee.displayName} />;
}
