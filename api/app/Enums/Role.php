<?php

namespace App\Enums;

enum Role: string
{
    case Owner = 'owner';
    case Admin = 'admin';
    case Agent = 'agent';

    /**
     * Owners and admins can see and manage every brand in their organization.
     */
    public function managesOrganization(): bool
    {
        return $this === self::Owner || $this === self::Admin;
    }
}
