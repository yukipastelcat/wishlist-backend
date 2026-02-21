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
  link?: string;
  claimable: boolean;
  isReserved?: boolean;
  isReservedByMe?: boolean;
  tags?: TagResponseDto[];
  price: GiftPriceDto | null;
};

export type GiftEditResponseDto = {
  id: string;
  createdAt: Date;
  titleLocalized: Record<string, string>;
  descriptionLocalized?: Record<string, string>;
  imageUrl?: string;
  link?: string;
  claimable: boolean;
  tagIds: string[];
  price: GiftPriceDto | null;
};
