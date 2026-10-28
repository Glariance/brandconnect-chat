<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\IndexLiveVisitorsRequest;
use App\Http\Resources\LiveVisitorResource;
use App\Models\User;
use App\Services\VisitorPresenceService;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class LiveVisitorController extends Controller
{
    public function __construct(private VisitorPresenceService $presence) {}

    /**
     * Online visitors for brands the agent can access (presence heartbeats only).
     */
    public function index(IndexLiveVisitorsRequest $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        $brandQuery = $user->accessibleBrands()->select('brands.id');

        if ($request->filled('brand_id')) {
            abort_unless(
                $user->accessibleBrands()->whereKey($request->integer('brand_id'))->exists(),
                403,
                'You do not have access to this brand.',
            );
            $brandIds = collect([(int) $request->integer('brand_id')]);
        } else {
            $brandIds = $brandQuery->pluck('id');
        }

        $rows = $this->presence->listOnline($brandIds);

        // Simple offset pagination via cursor = integer offset for this small live set.
        $offset = max(0, (int) $request->input('cursor', 0));
        $perPage = 50;
        $slice = $rows->slice($offset, $perPage)->values();
        $next = ($offset + $perPage) < $rows->count() ? (string) ($offset + $perPage) : null;

        return LiveVisitorResource::collection($slice)->additional([
            'meta' => [
                'next_cursor' => $next,
                'prev_cursor' => $offset > 0 ? (string) max(0, $offset - $perPage) : null,
                'total' => $rows->count(),
            ],
        ]);
    }
}