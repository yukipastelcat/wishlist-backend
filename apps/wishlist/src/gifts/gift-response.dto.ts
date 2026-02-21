import { GiftClaim } from './gift-claim.entity';

export type GiftPriceDto = {
  amount: number;
  currency: string;
};

export type TagResponseDto = {
  id: string;
  createdAt: Date;
  title: string;
  color: string;
};

export type GiftResponseDto = {
  id: string;
  createdAt: Date;
  title: string;
  description?: string;
  imageUrl?: string;
  claimable: boolean;
  claimId?: string | null;
  tags?: TagResponseDto[];
  claims?: GiftClaim[];
  price: GiftPriceDto | null;
};
