import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ReportSection({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className='text-muted-foreground text-sm'>{description}</p>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>{children}</CardContent>
    </Card>
  );
}
