import { createFileRoute } from "@tanstack/react-router";
import { SessionList } from "../components/session/session-list";

export const Route = createFileRoute("/")({
	component: SessionListPage,
});

function SessionListPage() {
	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight text-text-h">
					Sessions
				</h1>
				<p className="text-sm text-text">
					Browse and inspect your timeline sessions.
				</p>
			</div>
			<SessionList />
		</div>
	);
}