import HomeClient from "@/components/HomeClient";
import { getWildfireAdapter } from "@/lib/wildfire";

export default async function HomePage() {
  const events = await getWildfireAdapter().listEvents();

  return <HomeClient events={events} />;
}
